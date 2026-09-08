import { create } from 'zustand';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  FeedEntry,
  GameMode,
  GameSettings,
  GuessResult,
  PublicRoomSummary,
  PublicUser,
  RoomState,
  ServerToClientEvents,
} from '@mivimoose/shared';
import { connectDiscord, guestLogin, isEmbedded, setActivity, SOCKET_PATH, type DiscordContext } from './discord';
import { setApiToken } from './api';

export type Tab = 'play' | 'daily' | 'ranks' | 'profile';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'warn' | 'error';
  text: string;
}

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface AppState {
  status: 'boot' | 'auth' | 'ready' | 'error';
  bootMessage: string;
  error: string | null;

  ctx: DiscordContext | null;
  user: PublicUser | null;
  socket: GameSocket | null;
  connected: boolean;

  room: RoomState | null;
  /** serverNow - clientNow, so countdowns stay honest across clock skew. */
  clockOffset: number;
  publicRooms: PublicRoomSummary[];

  tab: Tab;
  toasts: Toast[];
  /** Rejected-guess message shown under the input. */
  guessError: string | null;
  /** Guess ids that arrived in the last moment, for the flash animation. */
  latestGuessId: string | null;
  /**
   * The exact row the server handed back for the last submission.
   *
   * Needed because a replayed word comes back as a copy of the ORIGINAL row
   * with `repeat: true`, while the copy stored in room state still has
   * `repeat: false`. Pinning straight from room state would silently drop the
   * "already guessed" marker.
   */
  latestGuess: GuessResult | null;
  /**
   * Bumped on every submitted guess, including one that turns out to be a
   * repeat. The pinned row keys off it so replaying a word you already tried
   * still visibly flashes rather than silently doing nothing.
   */
  guessSeq: number;

  boot: () => Promise<void>;
  bootGuest: (name?: string) => Promise<void>;
  setTab: (tab: Tab) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;

  createRoom: (settings: Partial<GameSettings>) => Promise<string | null>;
  joinRoom: (code: string, asSpectator?: boolean) => Promise<boolean>;
  quickplay: (mode: GameMode) => Promise<void>;
  joinInstanceRoom: (mode?: GameMode) => Promise<void>;
  leaveRoom: () => void;
  refreshLobby: () => void;

  updateSettings: (patch: Partial<GameSettings>) => void;
  setReady: (ready: boolean) => void;
  startMatch: () => void;
  kick: (playerId: string) => void;
  transferHost: (playerId: string) => void;
  rematch: () => void;

  guess: (word: string) => Promise<GuessResult | null>;
  hint: () => Promise<void>;
  giveUp: () => void;
  sendChat: (text: string) => void;
  sendEmote: (emote: string) => void;
  clearGuessError: () => void;
}

let toastSeq = 0;

export const useStore = create<AppState>((set, get) => ({
  status: 'boot',
  bootMessage: 'Waking Mivi up',
  error: null,

  ctx: null,
  user: null,
  socket: null,
  connected: false,

  room: null,
  clockOffset: 0,
  publicRooms: [],

  tab: 'play',
  toasts: [],
  guessError: null,
  latestGuessId: null,
  latestGuess: null,
  guessSeq: 0,

  /* ---------------------------------------------------------------- */

  async boot() {
    try {
      set({ status: 'auth', bootMessage: 'Talking to Discord' });
      const ctx = await connectDiscord();
      finishBoot(ctx, set, get);
    } catch (err) {
      // In a plain browser tab the Discord handshake cannot succeed. Fall
      // through to the dev login screen rather than dead-ending.
      if (!isEmbedded) {
        set({ status: 'auth', bootMessage: '', error: null });
        return;
      }
      set({ status: 'error', error: err instanceof Error ? err.message : 'Could not start' });
    }
  },

  async bootGuest(name?: string) {
    try {
      set({ status: 'boot', bootMessage: 'Setting you up' });
      const ctx = await guestLogin(name);
      finishBoot(ctx, set, get);
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : 'Could not sign in' });
    }
  },

  setTab: (tab) => set({ tab }),

  toast: (kind, text) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  /* ---------------------------------------------------------------- */

  async createRoom(settings) {
    const socket = get().socket;
    if (!socket) return null;
    const res = await emit<{ code: string }>(socket, 'room:create', settings);
    if (!res.ok) {
      get().toast('error', res.error ?? 'Could not create the room');
      return null;
    }
    return res.data?.code ?? null;
  },

  async joinRoom(code, asSpectator = false) {
    const socket = get().socket;
    if (!socket) return false;
    const res = await emit<{ code: string }>(socket, 'room:join', { code, asSpectator });
    if (!res.ok) {
      get().toast('error', res.error ?? 'Could not join');
      return false;
    }
    return true;
  },

  async quickplay(mode) {
    const socket = get().socket;
    if (!socket) return;
    const res = await emit<{ code: string }>(socket, 'room:quickplay', { mode });
    if (!res.ok) get().toast('error', res.error ?? 'No games available');
  },

  async joinInstanceRoom(mode) {
    const socket = get().socket;
    if (!socket) return;
    const res = await emit<{ code: string }>(socket, 'room:joinInstance', { mode });
    if (!res.ok) get().toast('error', res.error ?? 'Could not open the channel lobby');
  },

  leaveRoom() {
    get().socket?.emit('room:leave');
    set({ room: null });
  },

  refreshLobby() {
    const socket = get().socket;
    if (!socket) return;
    socket.emit('lobby:list', (res: Ack<PublicRoomSummary[]>) => {
      if (res.ok && res.data) set({ publicRooms: res.data });
    });
  },

  updateSettings(patch) {
    get().socket?.emit('room:settings', patch, (res) => {
      if (!res.ok) get().toast('warn', res.error ?? 'Could not change that');
    });
  },

  setReady: (ready) => get().socket?.emit('room:ready', ready),

  startMatch() {
    get().socket?.emit('room:start', (res) => {
      if (!res.ok) get().toast('warn', res.error ?? 'Cannot start yet');
    });
  },

  kick: (playerId) => get().socket?.emit('room:kick', { playerId }),
  transferHost: (playerId) => get().socket?.emit('room:transferHost', { playerId }),

  rematch() {
    get().socket?.emit('room:rematch', (res) => {
      if (!res.ok) get().toast('warn', res.error ?? 'Cannot rematch');
    });
  },

  /* ---------------------------------------------------------------- */

  async guess(word) {
    const socket = get().socket;
    if (!socket) return null;
    set({ guessError: null });
    const res = await emit<GuessResult>(socket, 'game:guess', { word });
    if (!res.ok) {
      set({ guessError: res.error ?? 'That did not work' });
      return null;
    }
    set((s) => ({
      latestGuessId: res.data?.id ?? null,
      latestGuess: res.data ?? null,
      guessSeq: s.guessSeq + 1,
    }));
    return res.data ?? null;
  },

  async hint() {
    const socket = get().socket;
    if (!socket) return;
    const res = await emit<GuessResult>(socket, 'game:hint');
    if (!res.ok) get().toast('warn', res.error ?? 'No hint available');
    else
      set((s) => ({
        latestGuessId: res.data?.id ?? null,
        latestGuess: res.data ?? null,
        guessSeq: s.guessSeq + 1,
      }));
  },

  giveUp: () => get().socket?.emit('game:giveUp'),
  sendChat: (text) => get().socket?.emit('chat:send', { text }),
  sendEmote: (emote) => get().socket?.emit('emote:send', { emote }),
  clearGuessError: () => set({ guessError: null }),
}));

/* ------------------------------------------------------------------ *
 * Socket plumbing
 * ------------------------------------------------------------------ */

/** Promise wrapper around socket.io acknowledgements. */
function emit<T>(socket: GameSocket, event: string, payload?: unknown): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve({ ok: false, error: 'The server did not answer' }), 8000);
    const done = (res: Ack<T>) => {
      clearTimeout(timeout);
      resolve(res ?? { ok: false, error: 'Empty response' });
    };
    const emitter = socket as unknown as {
      emit: (ev: string, ...args: unknown[]) => void;
    };
    if (payload === undefined) emitter.emit(event, done);
    else emitter.emit(event, payload, done);
  });
}

type SetState = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;

function finishBoot(ctx: DiscordContext, set: SetState, get: () => AppState) {
  setApiToken(ctx.token);

  const socket: GameSocket = io({
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    auth: { token: ctx.token, instanceId: ctx.instanceId, guildId: ctx.guildId },
  });

  socket.on('connect', () => set({ connected: true }));
  socket.on('disconnect', () => set({ connected: false }));

  socket.on('connect_error', (err) => {
    set({ connected: false });
    get().toast('error', err.message || 'Lost the connection');
  });

  socket.on('session', ({ user }) => set({ user }));

  socket.on('room:state', (room: RoomState) => {
    set({ room, clockOffset: room.now - Date.now() });
  });

  socket.on('room:closed', ({ reason }) => {
    set({ room: null });
    get().toast('warn', reason);
  });

  socket.on('game:feed', (entry: FeedEntry) => {
    // Feed entries also arrive inside room:state; this keeps the log live
    // between state pushes without waiting for a full re-serialise.
    set((s) =>
      s.room && !s.room.feed.some((f) => f.id === entry.id)
        ? { room: { ...s.room, feed: [...s.room.feed, entry].slice(-80) } }
        : {},
    );
  });

  socket.on('round:start', () => set({ guessError: null, latestGuessId: null, latestGuess: null, guessSeq: 0 }));

  socket.on('toast', ({ kind, text }) => get().toast(kind, text));
  socket.on('error', ({ message }) => get().toast('error', message));

  set({ ctx, user: ctx.user, socket, status: 'ready', error: null });

  // If we were launched inside a voice channel, everyone lands in the same
  // room automatically — no codes to read out loud.
  if (ctx.instanceId) void get().joinInstanceRoom();
  void setActivity('Mivimoose Guess', 'In the lobby');
}
