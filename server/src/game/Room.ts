import { nanoid } from 'nanoid';
import {
  bandForRank,
  isTurnBased,
  MODES,
  rankProgress,
  scoreRound,
  type FeedEntry,
  type GameSettings,
  type GuessResult,
  type MatchResult,
  type PublicUser,
  type RoomPhase,
  type RoomPlayer,
  type RoomState,
  type RoundSummary,
  type RoundSummaryEntry,
} from '@mivimoose/shared';
import { log } from '../log.js';
import { pickSecrets } from '../engine/lexicon.js';
import {
  getRankTable,
  neighboursOf,
  pickHint,
  precomputeRankTable,
  rankOf,
  resolveWord,
  type RankTable,
} from '../engine/ranker.js';
import { isBlocked, isTooCommon } from '../engine/wordFilter.js';

const COUNTDOWN_MS = 3500;
/** Quick match waits this long once a lobby is viable, so people can trickle in. */
const AUTO_START_WAIT_MS = 30_000;
/** Once it is full there is nothing to wait for. */
const AUTO_START_FULL_MS = 5_000;
/** Quick match is a multiplayer front door; one person is not a match. */
const AUTO_START_MIN_PLAYERS = 2;
const ROUND_REVIEW_MS = 9000;
const FEED_LIMIT = 80;
/** A guess this far out gets you frozen when the setting is on. */
const COLD_RANK_THRESHOLD = 25000;

export class GuessRejected extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface PlayerState {
  user: PublicUser;
  sockets: Set<string>;
  connected: boolean;
  ready: boolean;
  isSpectator: boolean;

  // Match-scoped
  score: number;
  eliminated: boolean;
  wordsFound: number;
  totalGuesses: number;
  placements: number[];
  ratingBefore: number | null;

  // Round-scoped
  guesses: GuessResult[];
  guessedWords: Set<string>;
  bestRank: number | null;
  foundAt: number | null;
  gaveUp: boolean;
  strikes: number;
  hintsLeft: number;
  hintsUsed: number;
  frozenUntil: number | null;
  streak: number;
}

export interface RoomBus {
  /** Send to every connected member of the room, players and spectators. */
  toRoom<T>(code: string, event: string, payload: T): void;
  toUser<T>(userId: string, event: string, payload: T): void;
  /** Re-serialise and push room state to everybody (per-viewer redaction). */
  sync(room: Room): void;
  /** Fired once when a match completes, for persistence. */
  onMatchComplete(room: Room, result: MatchResult): void;
  onRoomEmpty(room: Room): void;
}

export class Room {
  readonly code: string;
  readonly createdAt = Date.now();
  settings: GameSettings;
  hostId: string;
  guildId: string | null;
  instanceId: string | null;

  phase: RoomPhase = 'lobby';
  players = new Map<string, PlayerState>();
  spectators = new Map<string, PublicUser>();

  round = 0;
  secrets: string[] = [];
  table: RankTable | null = null;
  roundStartedAt = 0;
  deadline: number | null = null;
  activePlayerId: string | null = null;
  teamGuessesLeft: number | null = null;

  /**
   * Every word played this round, mapped to whoever played it first. Nothing
   * about it reaches the client: it exists only to close a word to everybody
   * else, and the rejection it produces carries no rank and no name.
   */
  claimed = new Map<string, string>();
  feed: FeedEntry[] = [];
  rounds: RoundSummary[] = [];
  result: MatchResult | null = null;
  matchId: string | null = null;
  /** Flat guess log for the whole match, kept for persistence and replays. */
  matchGuessLog: {
    userId: string;
    round: number;
    word: string;
    rank: number;
    isHint: boolean;
    msIntoRound: number;
  }[] = [];

  /**
   * Quick-match lobbies. Nobody owns the settings and nobody has to press
   * start — the room fills and goes on its own.
   */
  managed = false;
  autoStartAt: number | null = null;

  private timer: NodeJS.Timeout | null = null;
  private autoTimer: NodeJS.Timeout | null = null;
  private bus: RoomBus;

  constructor(opts: {
    code: string;
    settings: GameSettings;
    hostId: string;
    bus: RoomBus;
    guildId?: string | null;
    instanceId?: string | null;
    managed?: boolean;
  }) {
    this.code = opts.code;
    this.settings = opts.settings;
    this.hostId = opts.hostId;
    this.bus = opts.bus;
    this.guildId = opts.guildId ?? null;
    this.instanceId = opts.instanceId ?? null;
    this.managed = opts.managed ?? false;
  }

  /* ---------------------------------------------------------------- *
   * Quick match
   * ---------------------------------------------------------------- */

  /**
   * Decides whether a managed lobby should be counting down, and to when.
   *
   * The countdown only ever shortens. If it could be pushed back, every new
   * arrival would reset the clock and a busy lobby would never actually start.
   */
  private evaluateAutoStart(): void {
    if (!this.managed || this.phase !== 'lobby') {
      this.clearAutoStart();
      return;
    }

    const count = this.activePlayers.length;
    const needed = Math.max(AUTO_START_MIN_PLAYERS, MODES[this.settings.mode].minPlayers);
    if (count < needed) {
      this.clearAutoStart();
      return;
    }

    const full = count >= this.settings.maxPlayers;
    const target = Date.now() + (full ? AUTO_START_FULL_MS : AUTO_START_WAIT_MS);
    if (this.autoStartAt !== null && this.autoStartAt <= target) return;

    this.autoStartAt = target;
    this.deadline = target;
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => {
      this.autoTimer = null;
      this.autoStartAt = null;
      if (this.phase === 'lobby' && this.activePlayers.length >= needed) this.start();
    }, Math.max(0, target - Date.now()));
  }

  private clearAutoStart(): void {
    if (this.autoTimer) clearTimeout(this.autoTimer);
    this.autoTimer = null;
    if (this.autoStartAt !== null) {
      this.autoStartAt = null;
      if (this.phase === 'lobby') this.deadline = null;
    }
  }

  /* ---------------------------------------------------------------- *
   * Membership
   * ---------------------------------------------------------------- */

  get activePlayers(): PlayerState[] {
    return [...this.players.values()].filter((p) => !p.isSpectator);
  }

  /** Players still contesting the current round. */
  get contenders(): PlayerState[] {
    return this.activePlayers.filter((p) => !p.eliminated);
  }

  get isFull(): boolean {
    return this.activePlayers.length >= this.settings.maxPlayers;
  }

  get memberCount(): number {
    return this.players.size + this.spectators.size;
  }

  join(user: PublicUser, socketId: string, asSpectator = false): PlayerState | null {
    const existing = this.players.get(user.id);
    if (existing) {
      existing.sockets.add(socketId);
      existing.connected = true;
      existing.user = user;
      this.bus.sync(this);
      return existing;
    }

    const mustSpectate = asSpectator || this.isFull || this.phase !== 'lobby';
    if (mustSpectate) {
      if (!this.settings.allowSpectators && !asSpectator) return null;
      this.spectators.set(user.id, user);
      this.pushFeed({ kind: 'join', playerId: user.id, displayName: user.displayName, text: `${user.displayName} is watching` });
      this.bus.sync(this);
      return null;
    }

    const state: PlayerState = {
      user,
      sockets: new Set([socketId]),
      connected: true,
      ready: false,
      isSpectator: false,
      score: 0,
      eliminated: false,
      wordsFound: 0,
      totalGuesses: 0,
      placements: [],
      ratingBefore: null,
      guesses: [],
      guessedWords: new Set(),
      bestRank: null,
      foundAt: null,
      gaveUp: false,
      strikes: 0,
      hintsLeft: this.settings.hints,
      hintsUsed: 0,
      frozenUntil: null,
      streak: 0,
    };
    this.players.set(user.id, state);
    this.pushFeed({ kind: 'join', playerId: user.id, displayName: user.displayName, text: `${user.displayName} joined` });
    this.evaluateAutoStart();
    this.bus.sync(this);
    return state;
  }

  detachSocket(userId: string, socketId: string): void {
    const player = this.players.get(userId);
    if (player) {
      player.sockets.delete(socketId);
      if (player.sockets.size === 0) {
        player.connected = false;
        // In the lobby a disconnect is a leave; mid-match we hold the seat so
        // a dropped connection does not cost somebody their score.
        if (this.phase === 'lobby' || this.phase === 'matchEnd') {
          this.removePlayer(userId, 'left');
          return;
        }
        this.pushFeed({ kind: 'leave', playerId: userId, displayName: player.user.displayName, text: `${player.user.displayName} disconnected` });
      }
    } else if (this.spectators.has(userId)) {
      this.spectators.delete(userId);
    }
    this.checkEmpty();
    this.bus.sync(this);
  }

  removePlayer(userId: string, reason: 'left' | 'kicked'): void {
    const player = this.players.get(userId);
    this.players.delete(userId);
    this.spectators.delete(userId);
    if (player) {
      this.pushFeed({
        kind: 'leave',
        playerId: userId,
        displayName: player.user.displayName,
        text: reason === 'kicked' ? `${player.user.displayName} was removed` : `${player.user.displayName} left`,
      });
    }

    if (this.hostId === userId) this.reassignHost();
    if (this.activePlayerId === userId) this.advanceTurn();

    if (this.phase === 'playing' && this.contenders.length === 0) {
      this.endRound('everyone left');
      return;
    }
    if (this.phase === 'playing') this.maybeEndRound();

    this.evaluateAutoStart();
    this.checkEmpty();
    this.bus.sync(this);
  }

  private reassignHost(): void {
    const next = this.activePlayers.find((p) => p.connected) ?? this.activePlayers[0];
    if (next) {
      this.hostId = next.user.id;
      this.pushFeed({ kind: 'system', text: `${next.user.displayName} is now the host` });
    }
  }

  private checkEmpty(): void {
    const anyoneHome = [...this.players.values()].some((p) => p.connected) || this.spectators.size > 0;
    if (!anyoneHome) this.bus.onRoomEmpty(this);
  }

  transferHost(targetId: string): boolean {
    const target = this.players.get(targetId);
    if (!target) return false;
    this.hostId = targetId;
    this.pushFeed({ kind: 'system', text: `${target.user.displayName} is now the host` });
    this.bus.sync(this);
    return true;
  }

  setReady(userId: string, ready: boolean): void {
    const player = this.players.get(userId);
    if (!player || this.phase !== 'lobby') return;
    player.ready = ready;
    this.bus.sync(this);
  }

  updateSettings(settings: GameSettings): void {
    this.settings = settings;
    // Shrinking the lobby bumps the newest arrivals to spectators.
    while (this.activePlayers.length > settings.maxPlayers) {
      const victim = this.activePlayers[this.activePlayers.length - 1];
      if (!victim || victim.user.id === this.hostId) break;
      this.players.delete(victim.user.id);
      this.spectators.set(victim.user.id, victim.user);
    }
    for (const player of this.players.values()) player.hintsLeft = settings.hints;
    this.bus.sync(this);
  }

  /* ---------------------------------------------------------------- *
   * Match lifecycle
   * ---------------------------------------------------------------- */

  canStart(): { ok: boolean; reason?: string } {
    const descriptor = MODES[this.settings.mode];
    const count = this.activePlayers.length;
    if (this.phase !== 'lobby' && this.phase !== 'matchEnd') {
      return { ok: false, reason: 'A match is already running' };
    }
    if (count < descriptor.minPlayers) {
      return { ok: false, reason: `${descriptor.name} needs at least ${descriptor.minPlayers} players` };
    }
    return { ok: true };
  }

  start(): { ok: boolean; reason?: string } {
    const check = this.canStart();
    if (!check.ok) return check;

    const { settings } = this;
    this.matchId = nanoid(16);
    this.rounds = [];
    this.result = null;
    this.round = 0;
    this.matchGuessLog = [];

    const totalRounds = settings.rounds;
    if (settings.customWords?.length) {
      const shuffled = [...settings.customWords];
      // Deterministic shuffle when a seed is set so a custom game replays exactly.
      const seed = settings.seed ?? this.matchId;
      let h = 0;
      for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
      for (let i = shuffled.length - 1; i > 0; i--) {
        h = (Math.imul(h, 1664525) + 1013904223) >>> 0;
        const j = h % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      this.secrets = shuffled.slice(0, totalRounds);
    } else {
      this.secrets = pickSecrets(totalRounds, {
        difficulty: settings.difficulty,
        category: settings.category,
        seed: settings.seed,
      });
    }

    for (const player of this.players.values()) {
      player.score = 0;
      player.eliminated = false;
      player.wordsFound = 0;
      player.totalGuesses = 0;
      player.placements = [];
      player.streak = 0;
      player.ready = false;
    }

    this.clearAutoStart();
    this.phase = 'countdown';
    this.deadline = Date.now() + COUNTDOWN_MS;
    this.pushFeed({ kind: 'system', text: `${MODES[settings.mode].name} starting — ${totalRounds} ${totalRounds === 1 ? 'word' : 'words'}` });
    this.bus.sync(this);

    precomputeRankTable(this.secrets[0]);
    this.schedule(COUNTDOWN_MS, () => this.beginRound(1));
    return { ok: true };
  }

  private beginRound(round: number): void {
    const secret = this.secrets[round - 1];
    if (!secret) {
      this.endMatch();
      return;
    }

    this.round = round;
    this.table = getRankTable(secret);
    this.phase = 'playing';
    this.roundStartedAt = Date.now();
    this.claimed.clear();
    this.teamGuessesLeft = this.settings.mode === 'coop' ? this.settings.teamGuessBudget : null;

    for (const player of this.players.values()) {
      player.guesses = [];
      player.guessedWords = new Set();
      player.bestRank = null;
      player.foundAt = null;
      player.gaveUp = false;
      player.strikes = 0;
      player.hintsLeft = this.settings.hints;
      player.hintsUsed = 0;
      player.frozenUntil = null;
    }

    if (isTurnBased(this.settings.mode)) {
      const first = this.contenders[0];
      this.activePlayerId = first?.user.id ?? null;
      this.deadline = this.settings.roundSeconds ? Date.now() + this.settings.roundSeconds * 1000 : null;
    } else {
      this.activePlayerId = null;
      this.deadline = this.settings.roundSeconds ? Date.now() + this.settings.roundSeconds * 1000 : null;
    }

    this.pushFeed({ kind: 'system', text: `Round ${round} of ${this.secrets.length}` });
    this.bus.toRoom(this.code, 'round:start', {
      round,
      deadline: this.deadline,
      now: Date.now(),
    });
    this.bus.sync(this);

    if (this.deadline) {
      this.schedule(this.deadline - Date.now(), () => this.onDeadline());
    }
    if (this.secrets[round]) precomputeRankTable(this.secrets[round]);
  }

  private onDeadline(): void {
    if (this.phase !== 'playing') return;
    if (isTurnBased(this.settings.mode)) {
      const player = this.activePlayerId ? this.players.get(this.activePlayerId) : null;
      if (player) {
        player.strikes += 1;
        this.pushFeed({
          kind: 'system',
          playerId: player.user.id,
          displayName: player.user.displayName,
          text: `${player.user.displayName} ran out of time — strike ${player.strikes}/${this.settings.strikes}`,
        });
        if (player.strikes >= this.settings.strikes) this.strikeOut(player);
      }
      this.advanceTurn();
      this.maybeEndRound();
      this.bus.sync(this);
      return;
    }
    this.endRound("time's up");
  }

  private strikeOut(player: PlayerState): void {
    player.gaveUp = true;
    this.pushFeed({
      kind: 'eliminated',
      playerId: player.user.id,
      displayName: player.user.displayName,
      text: `${player.user.displayName} struck out`,
    });
  }

  private advanceTurn(): void {
    if (!isTurnBased(this.settings.mode) || this.phase !== 'playing') return;
    const eligible = this.contenders.filter((p) => !p.gaveUp && p.foundAt === null);
    if (eligible.length === 0) {
      this.activePlayerId = null;
      return;
    }
    const currentIndex = eligible.findIndex((p) => p.user.id === this.activePlayerId);
    const next = eligible[(currentIndex + 1) % eligible.length];
    this.activePlayerId = next.user.id;
    this.deadline = this.settings.roundSeconds ? Date.now() + this.settings.roundSeconds * 1000 : null;
    if (this.deadline) this.schedule(this.deadline - Date.now(), () => this.onDeadline());
  }

  /* ---------------------------------------------------------------- *
   * Guessing
   * ---------------------------------------------------------------- */

  guess(userId: string, rawWord: string): GuessResult {
    const player = this.players.get(userId);
    if (!player) throw new GuessRejected('spectator', 'Spectators cannot guess');
    if (this.phase !== 'playing' || !this.table) {
      throw new GuessRejected('round-over', 'No round is running');
    }
    if (player.eliminated) throw new GuessRejected('spectator', 'You are out of this match');
    if (player.foundAt !== null) throw new GuessRejected('round-over', 'You already found it');
    if (player.gaveUp) throw new GuessRejected('round-over', 'You are out of this round');

    if (isTurnBased(this.settings.mode) && this.activePlayerId !== userId) {
      throw new GuessRejected('not-your-turn', 'Wait for your turn');
    }
    if (player.frozenUntil && player.frozenUntil > Date.now()) {
      const secs = Math.ceil((player.frozenUntil - Date.now()) / 1000);
      throw new GuessRejected('frozen', `Frozen for ${secs}s after that one`);
    }
    if (this.settings.guessLimit > 0 && player.guesses.length >= this.settings.guessLimit) {
      throw new GuessRejected('guess-limit', 'You are out of guesses');
    }
    if (this.teamGuessesLeft !== null && this.teamGuessesLeft <= 0) {
      throw new GuessRejected('team-budget', 'The team is out of guesses');
    }

    const trimmed = rawWord.trim();
    if (trimmed.length < 2) throw new GuessRejected('too-short', 'That is too short');
    if (trimmed.length > 32) throw new GuessRejected('unknown-word', 'That is not a word');

    const resolved = resolveWord(trimmed);
    if (!resolved) {
      throw new GuessRejected('unknown-word', `"${trimmed.toLowerCase()}" is not in the word list`);
    }

    // Checked on the resolved form as well as what was typed, so `bitches`
    // cannot walk in through the plural rule. Neither costs a guess: the word
    // never reaches the board, so there is nothing to charge for.
    if (isBlocked(trimmed) || isBlocked(resolved.word)) {
      throw new GuessRejected('blocked-word', 'That word is not allowed');
    }
    if (isTooCommon(resolved.word, true)) {
      throw new GuessRejected('too-common', `"${resolved.word}" is too common to score`);
    }

    // Replaying a word you already tried is not an error, it is a memory lapse.
    // Hand the original row straight back so the board re-pins it and says
    // "already guessed" — no guess spent, no budget spent, no scolding. Your
    // own rank is yours already, so showing it again reveals nothing.
    const previous = player.guesses.find((g) => g.word === resolved.word);
    if (previous) return { ...previous, repeat: true };

    // Somebody else got there first. They are told that and nothing else —
    // no rank, no name, not even whether the word was warm. Leaking either
    // would hand over a free read on an opponent's board, which is exactly
    // what keeping the boards private is for. It costs no guess, because a
    // word you are not allowed to play is not a turn you took.
    if (this.claimed.has(resolved.word)) {
      throw new GuessRejected('already-guessed', 'Already guessed');
    }

    const rank = rankOf(this.table, resolved.index);
    if (rank === null) {
      throw new GuessRejected('unknown-word', `"${resolved.word}" is too obscure to rank`);
    }

    return this.applyGuess(player, resolved.word, rank, false);
  }

  hint(userId: string): GuessResult {
    const player = this.players.get(userId);
    if (!player) throw new GuessRejected('spectator', 'Spectators cannot use hints');
    if (this.phase !== 'playing' || !this.table) throw new GuessRejected('round-over', 'No round is running');
    if (player.hintsLeft <= 0) throw new GuessRejected('guess-limit', 'No hints left');
    if (player.foundAt !== null) throw new GuessRejected('round-over', 'You already found it');

    const suggestion = pickHint(this.table, player.bestRank, player.guessedWords);
    if (!suggestion) throw new GuessRejected('unknown-word', 'No hint available');

    player.hintsLeft -= 1;
    player.hintsUsed += 1;
    const result = this.applyGuess(player, suggestion.word, suggestion.rank, true);
    this.pushFeed({
      kind: 'hint',
      playerId: player.user.id,
      displayName: player.user.displayName,
      text: `${player.user.displayName} used a hint`,
    });
    return result;
  }

  private applyGuess(player: PlayerState, word: string, rank: number, isHint: boolean): GuessResult {
    const now = Date.now();
    const elapsed = now - this.roundStartedAt;

    const result: GuessResult = {
      id: nanoid(10),
      word,
      rank,
      band: bandForRank(rank),
      progress: rankProgress(rank, this.table?.depth ?? 60000),
      at: elapsed,
      playerId: player.user.id,
      repeat: false,
      isHint,
    };

    player.guesses.push(result);
    player.guessedWords.add(word);
    player.totalGuesses += 1;
    if (this.teamGuessesLeft !== null) this.teamGuessesLeft -= 1;

    this.claimed.set(word, player.user.id);

    const improved = player.bestRank === null || rank < player.bestRank;
    if (improved) player.bestRank = rank;

    // Sudden death: a guess that fails to beat the board costs you a strike.
    if (isTurnBased(this.settings.mode) && !isHint) {
      const boardBest = Math.min(
        ...this.contenders.map((p) => (p.user.id === player.user.id ? Infinity : (p.bestRank ?? Infinity))),
        player.guesses.length > 1 ? (player.guesses[player.guesses.length - 2]?.rank ?? Infinity) : Infinity,
      );
      if (rank !== 1 && Number.isFinite(boardBest) && rank >= boardBest) {
        player.strikes += 1;
        this.pushFeed({
          kind: 'system',
          playerId: player.user.id,
          displayName: player.user.displayName,
          text: `${player.user.displayName} failed to beat rank ${boardBest} — strike ${player.strikes}/${this.settings.strikes}`,
        });
        if (player.strikes >= this.settings.strikes) this.strikeOut(player);
      }
    }

    if (rank === 1) {
      player.foundAt = elapsed;
      player.wordsFound += 1;
      this.pushFeed({
        kind: 'found',
        playerId: player.user.id,
        displayName: player.user.displayName,
        text: `${player.user.displayName} found the word in ${player.guesses.length} ${player.guesses.length === 1 ? 'guess' : 'guesses'}`,
        rank: 1,
        band: 'found',
      });
    } else {
      if (this.settings.coldPenaltySeconds > 0 && rank > COLD_RANK_THRESHOLD) {
        player.frozenUntil = now + this.settings.coldPenaltySeconds * 1000;
      }
      this.publishGuess(player, result, improved);
    }

    if (isTurnBased(this.settings.mode)) this.advanceTurn();

    this.maybeEndRound();
    this.bus.sync(this);
    return result;
  }

  /** Respect the room's visibility setting when telling everyone else about a guess. */
  private publishGuess(player: PlayerState, result: GuessResult, improved: boolean): void {
    const { visibility, mode } = this.settings;
    const name = player.user.displayName;

    if (mode === 'coop' || visibility === 'full') {
      this.pushFeed({
        kind: 'guess',
        playerId: player.user.id,
        displayName: name,
        // How close they got, never what they played. `full` is now the
        // loudest the room gets about a rank, and silent about the word.
        text: `${name} guessed at rank ${result.rank}`,
        rank: result.rank,
        band: result.band,
      });
      return;
    }
    if (visibility === 'best' && improved) {
      this.pushFeed({
        kind: 'guess',
        playerId: player.user.id,
        displayName: name,
        text: `${name} is now at rank ${result.rank}`,
        rank: result.rank,
        band: result.band,
      });
      return;
    }
    if (visibility === 'count') {
      this.pushFeed({
        kind: 'guess',
        playerId: player.user.id,
        displayName: name,
        text: `${name} guessed (${player.guesses.length})`,
      });
    }
  }

  giveUp(userId: string): void {
    const player = this.players.get(userId);
    if (!player || this.phase !== 'playing' || player.foundAt !== null) return;
    player.gaveUp = true;
    this.pushFeed({
      kind: 'system',
      playerId: userId,
      displayName: player.user.displayName,
      text: `${player.user.displayName} gave up on this word`,
    });
    if (isTurnBased(this.settings.mode) && this.activePlayerId === userId) this.advanceTurn();
    this.maybeEndRound();
    this.bus.sync(this);
  }

  /* ---------------------------------------------------------------- *
   * Round + match resolution
   * ---------------------------------------------------------------- */

  private maybeEndRound(): void {
    if (this.phase !== 'playing') return;
    const contenders = this.contenders;
    if (contenders.length === 0) {
      this.endRound('nobody left');
      return;
    }

    const finished = contenders.filter((p) => p.foundAt !== null || p.gaveUp);
    const someoneFound = contenders.some((p) => p.foundAt !== null);

    if (this.settings.endOnFirstFind && someoneFound) {
      this.endRound('found');
      return;
    }
    if (finished.length === contenders.length) {
      this.endRound('everyone finished');
      return;
    }
    if (this.teamGuessesLeft !== null && this.teamGuessesLeft <= 0) {
      this.endRound('out of team guesses');
      return;
    }
    if (this.settings.guessLimit > 0) {
      const spent = contenders.every(
        (p) => p.foundAt !== null || p.gaveUp || p.guesses.length >= this.settings.guessLimit,
      );
      if (spent) this.endRound('out of guesses');
    }
  }

  private endRound(reason: string): void {
    if (this.phase !== 'playing' || !this.table) return;
    this.clearTimer();
    this.phase = 'roundEnd';

    const secret = this.table.secret;
    const roundMs = this.settings.roundSeconds * 1000;
    const contenders = this.contenders;

    // Rank order: whoever found it first, then whoever got closest, then who
    // needed fewer guesses to get there.
    const ordered = [...contenders].sort((a, b) => {
      const aFound = a.foundAt ?? Number.POSITIVE_INFINITY;
      const bFound = b.foundAt ?? Number.POSITIVE_INFINITY;
      if (aFound !== bFound) return aFound - bFound;
      const aBest = a.bestRank ?? Number.POSITIVE_INFINITY;
      const bBest = b.bestRank ?? Number.POSITIVE_INFINITY;
      if (aBest !== bBest) return aBest - bBest;
      return a.guesses.length - b.guesses.length;
    });

    const entries: RoundSummaryEntry[] = ordered.map((player, i) => {
      const placement = i + 1;
      const points = scoreRound({
        bestRank: player.bestRank,
        found: player.foundAt !== null,
        foundAt: player.foundAt,
        roundMs,
        guessCount: player.guesses.length,
        placement,
        playerCount: ordered.length,
        hintsUsed: player.hintsUsed,
      });
      player.score += points;
      player.placements.push(placement);
      player.streak = player.foundAt !== null ? player.streak + 1 : 0;
      return {
        playerId: player.user.id,
        displayName: player.user.displayName,
        bestRank: player.bestRank,
        guessCount: player.guesses.length,
        foundAt: player.foundAt,
        points,
        placement,
      };
    });

    for (const player of contenders) {
      for (const guess of player.guesses) {
        this.matchGuessLog.push({
          userId: player.user.id,
          round: this.round,
          word: guess.word,
          rank: guess.rank,
          isHint: guess.isHint,
          msIntoRound: guess.at,
        });
      }
    }

    const eliminated: string[] = [];
    if (this.settings.mode === 'elimination' && ordered.length > 1) {
      const loser = ordered[ordered.length - 1];
      loser.eliminated = true;
      eliminated.push(loser.user.id);
      this.pushFeed({
        kind: 'eliminated',
        playerId: loser.user.id,
        displayName: loser.user.displayName,
        text: `${loser.user.displayName} is eliminated`,
      });
    }

    const summary: RoundSummary = {
      round: this.round,
      secret,
      neighbours: neighboursOf(this.table, 10),
      entries,
      eliminated,
    };
    this.rounds.push(summary);

    this.pushFeed({ kind: 'system', text: `The word was "${secret}" (${reason})` });
    this.bus.toRoom(this.code, 'round:end', summary);

    const survivors = this.contenders.length;
    const moreRounds = this.round < this.secrets.length;
    const eliminationOver = this.settings.mode === 'elimination' && survivors <= 1;

    if (!moreRounds || eliminationOver) {
      this.deadline = Date.now() + ROUND_REVIEW_MS;
      this.bus.sync(this);
      this.schedule(ROUND_REVIEW_MS, () => this.endMatch());
    } else {
      this.deadline = Date.now() + ROUND_REVIEW_MS;
      this.bus.sync(this);
      this.schedule(ROUND_REVIEW_MS, () => this.beginRound(this.round + 1));
    }
  }

  private endMatch(): void {
    this.clearTimer();
    this.phase = 'matchEnd';
    this.deadline = null;
    this.activePlayerId = null;

    const players = this.activePlayers;
    // Elimination ranks by survival; everything else by points.
    const ordered = [...players].sort((a, b) => {
      if (this.settings.mode === 'elimination' && a.eliminated !== b.eliminated) {
        return a.eliminated ? 1 : -1;
      }
      if (b.score !== a.score) return b.score - a.score;
      return b.wordsFound - a.wordsFound;
    });

    const entries = ordered.map((player, i) => ({
      playerId: player.user.id,
      displayName: player.user.displayName,
      avatarUrl: player.user.avatarUrl,
      score: player.score,
      placement: i + 1,
      wordsFound: player.wordsFound,
      totalGuesses: player.totalGuesses,
      bestRank: player.placements.length
        ? Math.min(...this.rounds.flatMap((r) =>
            r.entries.filter((e) => e.playerId === player.user.id && e.bestRank !== null).map((e) => e.bestRank!),
          ))
        : null,
      ratingBefore: null as number | null,
      ratingAfter: null as number | null,
      xpGained: 0,
    }));

    const result: MatchResult = {
      matchId: this.matchId ?? nanoid(16),
      mode: this.settings.mode,
      entries: entries.map((e) => ({
        ...e,
        bestRank: Number.isFinite(e.bestRank as number) ? e.bestRank : null,
      })),
      rounds: this.rounds,
    };

    this.result = result;
    this.pushFeed({ kind: 'system', text: `${entries[0]?.displayName ?? 'Nobody'} wins` });
    this.bus.sync(this);
    this.bus.onMatchComplete(this, result);
  }

  /** Persistence writes ratings and XP back so the results screen can show them. */
  applyResultAugmentation(result: MatchResult): void {
    this.result = result;
    this.bus.toRoom(this.code, 'match:end', result);
    this.bus.sync(this);
  }

  rematch(): { ok: boolean; reason?: string } {
    if (this.phase !== 'matchEnd') return { ok: false, reason: 'The match is still running' };
    this.phase = 'lobby';
    this.round = 0;
    this.rounds = [];
    this.result = null;
    this.deadline = null;
    this.table = null;
    this.claimed.clear();
    for (const player of this.players.values()) {
      player.eliminated = false;
      player.ready = false;
      player.score = 0;
      player.guesses = [];
      player.guessedWords = new Set();
      player.bestRank = null;
      player.foundAt = null;
    }
    // Anyone who joined mid-match takes a seat now if there is room.
    for (const [id, user] of [...this.spectators.entries()]) {
      if (this.activePlayers.length >= this.settings.maxPlayers) break;
      this.spectators.delete(id);
      this.join(user, 'rejoin', false);
    }
    this.pushFeed({ kind: 'system', text: 'Rematch — back to the lobby' });
    this.evaluateAutoStart();
    this.bus.sync(this);
    return { ok: true };
  }

  /* ---------------------------------------------------------------- *
   * Chat + feed
   * ---------------------------------------------------------------- */

  pushFeed(
    entry: Pick<FeedEntry, 'kind' | 'text'> & Partial<Omit<FeedEntry, 'id' | 'kind' | 'text'>>,
  ): FeedEntry {
    const full: FeedEntry = {
      id: nanoid(8),
      playerId: entry.playerId ?? null,
      displayName: entry.displayName ?? null,
      rank: entry.rank ?? null,
      band: entry.band ?? null,
      kind: entry.kind,
      text: entry.text,
      at: entry.at ?? Date.now(),
    };
    this.feed.push(full);
    if (this.feed.length > FEED_LIMIT) this.feed.splice(0, this.feed.length - FEED_LIMIT);
    this.bus.toRoom(this.code, 'game:feed', full);
    return full;
  }

  chat(userId: string, text: string): void {
    if (!this.settings.chatEnabled) return;
    const user = this.players.get(userId)?.user ?? this.spectators.get(userId);
    if (!user) return;
    const clean = text.trim().slice(0, 240);
    if (!clean) return;

    // Chat must never become a side channel for the answer.
    if (this.phase === 'playing' && this.table) {
      const lowered = clean.toLowerCase();
      if (new RegExp(`\\b${this.table.secret}\\b`).test(lowered)) {
        this.bus.toUser(userId, 'toast', { kind: 'warn', text: 'Nice try — that word is filtered from chat' });
        return;
      }
    }
    this.pushFeed({ kind: 'chat', playerId: userId, displayName: user.displayName, text: clean });
  }

  emote(userId: string, emote: string): void {
    if (!this.settings.emotesEnabled) return;
    const user = this.players.get(userId)?.user ?? this.spectators.get(userId);
    if (!user) return;
    this.pushFeed({ kind: 'emote', playerId: userId, displayName: user.displayName, text: emote.slice(0, 8) });
  }

  /* ---------------------------------------------------------------- *
   * Serialisation
   * ---------------------------------------------------------------- */

  private serializePlayer(player: PlayerState, viewerId: string | null): RoomPlayer {
    const revealAll = this.phase === 'roundEnd' || this.phase === 'matchEnd';
    const isSelf = player.user.id === viewerId;
    // A player who has already found this round's word is done: there is no
    // guess left for them to copy into, so the other boards open up and they
    // can watch the rest of the round out. The one live exception to keeping
    // words private, and it costs nothing because their round is over.
    const watching = viewerId !== null && (this.players.get(viewerId)?.foundAt ?? null) !== null;

    let status: RoomPlayer['status'] = 'lobby';
    if (!player.connected) status = 'disconnected';
    else if (player.eliminated) status = 'eliminated';
    else if (this.phase === 'lobby') status = player.ready ? 'ready' : 'lobby';
    else if (player.foundAt !== null) status = 'found';
    else if (this.phase === 'playing') status = 'playing';

    return {
      user: player.user,
      status,
      isHost: player.user.id === this.hostId,
      connected: player.connected,
      score: player.score,
      // Hiding the opponent's rank is the whole point of the "hidden" setting.
      bestRank:
        isSelf || revealAll || watching || this.settings.visibility === 'best' || this.settings.visibility === 'full'
          ? player.bestRank
          : null,
      guessCount:
        isSelf || revealAll || watching || this.settings.visibility !== 'hidden'
          ? player.guesses.length
          : 0,
      foundAt: player.foundAt,
      strikes: player.strikes,
      hintsLeft: player.hintsLeft,
      streak: player.streak,
      placements: player.placements,
      frozenUntil: isSelf ? player.frozenUntil : null,
      // Words are private until the round is over, or until the viewer has
      // found it themselves. `visibility` still says how much of a rank the
      // room shares; it no longer says anything about which words were spent
      // getting there.
      guesses: isSelf || revealAll || watching ? player.guesses : undefined,
    };
  }

  serializeFor(viewerId: string | null): RoomState {
    return {
      code: this.code,
      phase: this.phase,
      mode: this.settings.mode,
      settings: this.settings,
      hostId: this.hostId,
      players: this.activePlayers.map((p) => this.serializePlayer(p, viewerId)),
      spectators: [...this.spectators.values()],
      round: this.round,
      totalRounds: this.secrets.length || this.settings.rounds,
      deadline: this.deadline,
      now: Date.now(),
      activePlayerId: this.activePlayerId,
      lastRound: this.phase === 'roundEnd' || this.phase === 'matchEnd' ? (this.rounds[this.rounds.length - 1] ?? null) : null,
      feed: this.feed,
      autoStart: this.managed,
      teamGuessesLeft: this.teamGuessesLeft,
      result: this.result,
    };
  }

  summary() {
    return {
      code: this.code,
      mode: this.settings.mode,
      hostName: this.players.get(this.hostId)?.user.displayName ?? 'Unknown',
      players: this.activePlayers.length,
      maxPlayers: this.settings.maxPlayers,
      phase: this.phase,
      difficulty: this.settings.difficulty,
      ranked: this.settings.ranked,
    };
  }

  /* ---------------------------------------------------------------- *
   * Timers
   * ---------------------------------------------------------------- */

  private schedule(ms: number, fn: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (err) {
        log.error(`room ${this.code}: scheduled task failed`, err);
      }
    }, Math.max(0, ms));
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.clearTimer();
    this.clearAutoStart();
  }
}
