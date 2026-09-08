import {
  defaultsForMode,
  sanitizeSettings,
  type GameMode,
  type GameSettings,
  type MatchResult,
  type PublicRoomSummary,
  type PublicUser,
} from '@mivimoose/shared';
import { log } from '../log.js';
import { Room, type RoomBus } from './Room.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
const EMPTY_ROOM_GRACE_MS = 60_000;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private byInstance = new Map<string, string>();
  private reapTimers = new Map<string, NodeJS.Timeout>();
  private bus: RoomBus;

  constructor(bus: Omit<RoomBus, 'onRoomEmpty'> & Partial<Pick<RoomBus, 'onRoomEmpty'>>) {
    this.bus = {
      ...bus,
      onRoomEmpty: (room) => this.scheduleReap(room),
    } as RoomBus;
  }

  private newCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    // Vanishingly unlikely; widen rather than fail.
    return `${Date.now().toString(36).toUpperCase().slice(-6)}`;
  }

  create(opts: {
    host: PublicUser;
    settings: Partial<GameSettings>;
    guildId?: string | null;
    instanceId?: string | null;
    managed?: boolean;
  }): Room {
    const mode = (opts.settings.mode ?? 'classic') as GameMode;
    const settings = sanitizeSettings(opts.settings, defaultsForMode(mode));
    const room = new Room({
      code: this.newCode(),
      settings,
      hostId: opts.host.id,
      bus: this.bus,
      guildId: opts.guildId ?? null,
      instanceId: opts.instanceId ?? null,
      managed: opts.managed ?? false,
    });
    this.rooms.set(room.code, room);
    if (opts.instanceId) this.byInstance.set(opts.instanceId, room.code);
    log.info(`room ${room.code}: created (${settings.mode}) by ${opts.host.displayName}`);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  /**
   * Every player who launches the Activity in the same voice channel shares a
   * Discord instance id, so they should land in the same room without anybody
   * typing a code.
   */
  forInstance(instanceId: string): Room | undefined {
    const code = this.byInstance.get(instanceId);
    return code ? this.rooms.get(code) : undefined;
  }

  /** An open public room in the requested mode, or nothing. */
  findQuickplay(mode: GameMode): Room | undefined {
    const candidates = [...this.rooms.values()]
      .filter((r) => r.managed)
      .filter((r) => r.settings.mode === mode)
      .filter((r) => !r.settings.private)
      .filter((r) => r.phase === 'lobby')
      .filter((r) => !r.isFull)
      // Fill the fullest room first so lobbies converge instead of fragmenting.
      .sort((a, b) => b.activePlayers.length - a.activePlayers.length);
    return candidates[0];
  }

  listPublic(): PublicRoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => !r.settings.private)
      .filter((r) => r.activePlayers.length > 0)
      .sort((a, b) => {
        if (a.phase === 'lobby' && b.phase !== 'lobby') return -1;
        if (b.phase === 'lobby' && a.phase !== 'lobby') return 1;
        return b.activePlayers.length - a.activePlayers.length;
      })
      .slice(0, 40)
      .map((r) => r.summary());
  }

  findRoomForUser(userId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.players.has(userId) || room.spectators.has(userId)) return room;
    }
    return undefined;
  }

  private scheduleReap(room: Room): void {
    if (this.reapTimers.has(room.code)) return;
    const timer = setTimeout(() => {
      this.reapTimers.delete(room.code);
      const stillEmpty =
        ![...room.players.values()].some((p) => p.connected) && room.spectators.size === 0;
      if (stillEmpty) this.destroy(room.code);
    }, EMPTY_ROOM_GRACE_MS);
    this.reapTimers.set(room.code, timer);
  }

  cancelReap(code: string): void {
    const timer = this.reapTimers.get(code);
    if (timer) {
      clearTimeout(timer);
      this.reapTimers.delete(code);
    }
  }

  destroy(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    room.dispose();
    this.rooms.delete(code);
    if (room.instanceId) this.byInstance.delete(room.instanceId);
    this.cancelReap(code);
    log.info(`room ${code}: closed`);
  }

  stats() {
    const rooms = [...this.rooms.values()];
    return {
      rooms: rooms.length,
      players: rooms.reduce((sum, r) => sum + r.activePlayers.length, 0),
      spectators: rooms.reduce((sum, r) => sum + r.spectators.size, 0),
      inProgress: rooms.filter((r) => r.phase === 'playing').length,
    };
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  /** Wired up by the socket layer so persistence can annotate the result. */
  onMatchComplete?: (room: Room, result: MatchResult) => void;
}
