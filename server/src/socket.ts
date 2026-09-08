import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import {
  defaultsForMode,
  sanitizeSettings,
  GAME_MODES,
  MODES,
  type Ack,
  type GameMode,
  type GameSettings,
  type MatchResult,
  type PublicUser,
} from '@mivimoose/shared';
import { verifySession } from './auth.js';
import { displayRating, ensureGuildMembership, prisma, toPublicUser } from './db.js';
import { corsDelegate } from './cors.js';
import { env } from './env.js';
import { log } from './log.js';
import { GuessRejected, type Room } from './game/Room.js';
import { RoomManager } from './game/RoomManager.js';
import { recordMatch } from './persistence.js';

interface SocketData {
  user: PublicUser;
  guildId: string | null;
  instanceId: string | null;
  /** Simple token bucket so a script cannot machine-gun the ranker. */
  tokens: number;
  lastRefill: number;
}

const GUESS_BUCKET_SIZE = 8;
const GUESS_REFILL_PER_SEC = 3;

function takeToken(data: SocketData): boolean {
  const now = Date.now();
  const elapsed = (now - data.lastRefill) / 1000;
  data.tokens = Math.min(GUESS_BUCKET_SIZE, data.tokens + elapsed * GUESS_REFILL_PER_SEC);
  data.lastRefill = now;
  if (data.tokens < 1) return false;
  data.tokens -= 1;
  return true;
}

function fail<T>(message: string, code = 'error'): Ack<T> {
  return { ok: false, error: message, code };
}

function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

export function createSocketServer(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: corsDelegate,
    // Discord's Activity iframe proxies websockets; polling is the fallback.
    transports: ['websocket', 'polling'],
    pingTimeout: 25_000,
  });

  const manager = new RoomManager({
    toRoom: (code, event, payload) => {
      io.to(`room:${code}`).emit(event, payload);
    },
    toUser: (userId, event, payload) => {
      io.to(`user:${userId}`).emit(event, payload);
    },
    sync: (room) => {
      // Each viewer gets their own redaction of the state.
      for (const player of room.players.values()) {
        io.to(`user:${player.user.id}`).emit('room:state', room.serializeFor(player.user.id));
      }
      for (const spectator of room.spectators.values()) {
        io.to(`user:${spectator.id}`).emit('room:state', room.serializeFor(spectator.id));
      }
    },
    onMatchComplete: (room, result) => {
      void finishMatch(room, result);
    },
  });

  async function finishMatch(room: Room, result: MatchResult) {
    const augmented = await recordMatch(room, result);
    room.applyResultAugmentation(augmented);
  }

  /* ---------------------------------------------------------------- *
   * Handshake
   * ---------------------------------------------------------------- */

  io.use(async (socket, next) => {
    try {
      const { token, instanceId, guildId } = socket.handshake.auth as {
        token?: string;
        instanceId?: string;
        guildId?: string;
      };
      const claims = token ? verifySession(token) : null;
      if (!claims) return next(new Error('Not authenticated'));

      const user = await prisma.user.findUnique({ where: { id: claims.sub } });
      if (!user) return next(new Error('Unknown account'));

      const rating = await displayRating(user.id);
      const data: SocketData = {
        user: toPublicUser(user, rating),
        guildId: guildId ?? claims.gid ?? null,
        instanceId: instanceId ?? null,
        tokens: GUESS_BUCKET_SIZE,
        lastRefill: Date.now(),
      };
      Object.assign(socket.data, data);
      await ensureGuildMembership(data.guildId, user.id);
      next();
    } catch (err) {
      log.error('socket: handshake failed', err);
      next(new Error('Handshake failed'));
    }
  });

  io.on('connection', (socket) => {
    const data = socket.data as SocketData;
    const user = data.user;
    socket.join(`user:${user.id}`);
    socket.emit('session', { user });

    const currentRoom = (): Room | undefined => manager.findRoomForUser(user.id);

    const enterRoom = (room: Room, asSpectator = false) => {
      manager.cancelReap(room.code);
      socket.join(`room:${room.code}`);
      room.join(user, socket.id, asSpectator);
      socket.emit('room:state', room.serializeFor(user.id));
    };

    const leaveCurrent = () => {
      const room = currentRoom();
      if (!room) return;
      socket.leave(`room:${room.code}`);
      room.removePlayer(user.id, 'left');
    };

    // A reconnect drops straight back into whatever match was in progress.
    const existing = currentRoom();
    if (existing) enterRoom(existing);

    /* -------------------------------------------------------------- *
     * Room management
     * -------------------------------------------------------------- */

    socket.on('room:create', (settings: Partial<GameSettings>, ack?: (r: Ack<{ code: string }>) => void) => {
      leaveCurrent();
      const room = manager.create({
        host: user,
        settings,
        guildId: data.guildId,
        instanceId: data.instanceId,
      });
      enterRoom(room);
      ack?.(ok({ code: room.code }));
    });

    socket.on(
      'room:join',
      (payload: { code: string; asSpectator?: boolean }, ack?: (r: Ack<{ code: string }>) => void) => {
        const code = String(payload?.code ?? '').trim().toUpperCase();
        const room = manager.get(code);
        if (!room) return ack?.(fail('No room with that code', 'not-found'));
        if (room.isFull && !room.settings.allowSpectators && !room.players.has(user.id)) {
          return ack?.(fail('That room is full', 'full'));
        }
        leaveCurrent();
        enterRoom(room, payload?.asSpectator ?? false);
        ack?.(ok({ code: room.code }));
      },
    );

    socket.on('room:joinInstance', (payload: { mode?: GameMode }, ack?: (r: Ack<{ code: string }>) => void) => {
      if (!data.instanceId) return ack?.(fail('Not running inside a Discord activity', 'no-instance'));
      let room = manager.forInstance(data.instanceId);
      if (!room) {
        const mode = GAME_MODES.includes(payload?.mode as GameMode) ? (payload!.mode as GameMode) : 'classic';
        room = manager.create({
          host: user,
          settings: defaultsForMode(mode),
          guildId: data.guildId,
          instanceId: data.instanceId,
        });
      }
      leaveCurrent();
      enterRoom(room);
      ack?.(ok({ code: room.code }));
    });

    socket.on('room:quickplay', (payload: { mode: GameMode }, ack?: (r: Ack<{ code: string }>) => void) => {
      const mode = GAME_MODES.includes(payload?.mode) ? payload.mode : 'classic';
      leaveCurrent();
      // Quick match is a fixed configuration on purpose: a full lobby, and no
      // knobs. Anyone who wants to change something wants a custom game.
      const room =
        manager.findQuickplay(mode) ??
        manager.create({
          host: user,
          settings: { ...defaultsForMode(mode), maxPlayers: MODES[mode].maxPlayers },
          guildId: data.guildId,
          managed: true,
        });
      enterRoom(room);
      ack?.(ok({ code: room.code }));
    });

    socket.on('room:leave', (ack?: (r: Ack<null>) => void) => {
      leaveCurrent();
      ack?.(ok(null));
    });

    socket.on('room:settings', (patch: Partial<GameSettings>, ack?: (r: Ack<null>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      if (room.managed) {
        return ack?.(fail('Quick match settings are fixed — host a custom game to change them', 'locked'));
      }
      if (room.hostId !== user.id) return ack?.(fail('Only the host can change settings', 'not-host'));
      if (room.phase !== 'lobby') return ack?.(fail('Settings are locked once a match starts', 'locked'));
      room.updateSettings(sanitizeSettings(patch, room.settings));
      ack?.(ok(null));
    });

    socket.on('room:ready', (ready: boolean) => {
      currentRoom()?.setReady(user.id, Boolean(ready));
    });

    socket.on('room:start', (ack?: (r: Ack<null>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      if (room.hostId !== user.id) return ack?.(fail('Only the host can start', 'not-host'));
      const result = room.start();
      if (!result.ok) return ack?.(fail(result.reason ?? 'Cannot start', 'cannot-start'));
      ack?.(ok(null));
    });

    socket.on('room:kick', (payload: { playerId: string }, ack?: (r: Ack<null>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      if (room.hostId !== user.id) return ack?.(fail('Only the host can remove players', 'not-host'));
      if (payload?.playerId === user.id) return ack?.(fail('You cannot remove yourself'));
      io.to(`user:${payload.playerId}`).socketsLeave(`room:${room.code}`);
      io.to(`user:${payload.playerId}`).emit('room:closed', { reason: 'You were removed from the room' });
      room.removePlayer(payload.playerId, 'kicked');
      ack?.(ok(null));
    });

    socket.on('room:transferHost', (payload: { playerId: string }, ack?: (r: Ack<null>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      if (room.hostId !== user.id) return ack?.(fail('Only the host can pass the crown', 'not-host'));
      const done = room.transferHost(payload?.playerId);
      ack?.(done ? ok(null) : fail('That player is not here'));
    });

    socket.on('room:rematch', (ack?: (r: Ack<null>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      if (room.hostId !== user.id) return ack?.(fail('Only the host can call a rematch', 'not-host'));
      const result = room.rematch();
      ack?.(result.ok ? ok(null) : fail(result.reason ?? 'Cannot rematch'));
    });

    /* -------------------------------------------------------------- *
     * Gameplay
     * -------------------------------------------------------------- */

    socket.on('game:guess', (payload: { word: string }, ack?: (r: Ack<unknown>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      if (!takeToken(data)) return ack?.(fail('Slow down a moment', 'rate-limit'));
      try {
        const result = room.guess(user.id, String(payload?.word ?? ''));
        ack?.(ok(result));
      } catch (err) {
        if (err instanceof GuessRejected) return ack?.(fail(err.message, err.code));
        log.error('socket: guess failed', err);
        ack?.(fail('Something went wrong'));
      }
    });

    socket.on('game:hint', (ack?: (r: Ack<unknown>) => void) => {
      const room = currentRoom();
      if (!room) return ack?.(fail('You are not in a room'));
      try {
        ack?.(ok(room.hint(user.id)));
      } catch (err) {
        if (err instanceof GuessRejected) return ack?.(fail(err.message, err.code));
        ack?.(fail('Something went wrong'));
      }
    });

    socket.on('game:giveUp', () => {
      currentRoom()?.giveUp(user.id);
    });

    socket.on('chat:send', (payload: { text: string }) => {
      if (!takeToken(data)) return;
      currentRoom()?.chat(user.id, String(payload?.text ?? ''));
    });

    socket.on('emote:send', (payload: { emote: string }) => {
      if (!takeToken(data)) return;
      currentRoom()?.emote(user.id, String(payload?.emote ?? ''));
    });

    socket.on('lobby:list', (ack?: (r: Ack<unknown>) => void) => {
      ack?.(ok(manager.listPublic()));
    });

    socket.on('disconnect', () => {
      const room = currentRoom();
      if (room) room.detachSocket(user.id, socket.id);
    });
  });

  return { io, manager, modes: MODES };
}
