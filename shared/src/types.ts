/**
 * Wire protocol shared by the server and the Discord Activity client.
 * Everything here is structurally cloneable JSON.
 */

/* ------------------------------------------------------------------ *
 * Identity
 * ------------------------------------------------------------------ */

export interface PublicUser {
  id: string;
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** Elo used for ranked duels. */
  rating: number;
  title: string | null;
  /** Throwaway account with no Discord behind it. */
  isGuest: boolean;
}

export interface SessionPayload {
  token: string;
  user: PublicUser;
}

/* ------------------------------------------------------------------ *
 * Modes and settings
 * ------------------------------------------------------------------ */

export const GAME_MODES = [
  'classic',
  'duel',
  'blitz',
  'elimination',
  'marathon',
  'coop',
  'suddenDeath',
  'daily',
] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const DIFFICULTIES = ['easy', 'normal', 'hard', 'insane'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const CATEGORIES = [
  'any',
  'concrete',
  'abstract',
  'nature',
  'science',
  'culture',
  'emotion',
  'action',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** How much of an opponent's progress you can see while a round is live. */
export const VISIBILITY = ['hidden', 'count', 'best', 'full'] as const;
export type Visibility = (typeof VISIBILITY)[number];

export interface GameSettings {
  mode: GameMode;
  /** Seconds per round. 0 = untimed (mode permitting). */
  roundSeconds: number;
  /** Number of words played in the match. */
  rounds: number;
  maxPlayers: number;
  difficulty: Difficulty;
  category: Category;
  /** 0 = unlimited guesses. */
  guessLimit: number;
  /** Hints nudge you toward the answer at a score cost. 0 disables. */
  hints: number;
  /** What opponents can see of your board mid-round. */
  visibility: Visibility;
  /** End the round the instant somebody finds the word. */
  endOnFirstFind: boolean;
  /** Ranked matches move Elo. Only meaningful for duel/classic. */
  ranked: boolean;
  allowSpectators: boolean;
  /** Room is only reachable by code. */
  private: boolean;
  chatEnabled: boolean;
  emotesEnabled: boolean;
  /** suddenDeath: strikes before elimination. */
  strikes: number;
  /** coop: shared guess budget for the team. */
  teamGuessBudget: number;
  /** Freeze-out after a very cold guess, in seconds. 0 = off. */
  coldPenaltySeconds: number;
  /** Optional fixed word list for custom games (host supplied). */
  customWords: string[] | null;
  /** Deterministic seed so a custom game can be replayed exactly. */
  seed: string | null;
}

export interface ModeDescriptor {
  id: GameMode;
  name: string;
  tagline: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  icon: string;
  accent: string;
  /** Settings a host may not change for this mode. */
  locked: (keyof GameSettings)[];
  defaults: Partial<GameSettings>;
}

/* ------------------------------------------------------------------ *
 * Guesses
 * ------------------------------------------------------------------ */

export type RankBand = 'found' | 'hot' | 'warm' | 'cool' | 'cold' | 'frozen';

export interface GuessResult {
  id: string;
  word: string;
  /** 1 = the secret word itself. */
  rank: number;
  band: RankBand;
  /**
   * Log-scaled 0..1 closeness, the same curve scoring uses. NOT the width of
   * the bar in the UI — that is `heatFraction(rank)`, an exponential that stays
   * near zero across the cold tail. Kept on the wire because it is the honest
   * "how far along are you" number for anything that is not a bar.
   */
  progress: number;
  at: number;
  playerId: string;
  /** True when the guess is a repeat by the same player. */
  repeat: boolean;
  isHint: boolean;
}

export type GuessErrorCode =
  | 'unknown-word'
  | 'blocked-word'
  | 'too-common'
  | 'too-short'
  | 'already-guessed'
  | 'guess-limit'
  | 'not-your-turn'
  | 'round-over'
  | 'frozen'
  | 'spectator'
  | 'team-budget';

/* ------------------------------------------------------------------ *
 * Room + match state
 * ------------------------------------------------------------------ */

export type PlayerStatus =
  | 'lobby'
  | 'ready'
  | 'playing'
  | 'found'
  | 'eliminated'
  | 'spectating'
  | 'disconnected';

export interface RoomPlayer {
  user: PublicUser;
  status: PlayerStatus;
  isHost: boolean;
  connected: boolean;
  /** Cumulative match score. */
  score: number;
  /** Best (lowest) rank achieved this round; null before any guess. */
  bestRank: number | null;
  guessCount: number;
  /** ms into the round when they found the word. */
  foundAt: number | null;
  strikes: number;
  hintsLeft: number;
  streak: number;
  /** Round-level placements, index = round number - 1. */
  placements: number[];
  frozenUntil: number | null;
  /** Only sent to the owning player, and to everyone once the round ends. */
  guesses?: GuessResult[];
}

export type RoomPhase = 'lobby' | 'countdown' | 'playing' | 'roundEnd' | 'matchEnd';

export interface RoundSummaryEntry {
  playerId: string;
  displayName: string;
  bestRank: number | null;
  guessCount: number;
  foundAt: number | null;
  points: number;
  placement: number;
}

export interface RoundSummary {
  round: number;
  secret: string;
  /** Nearest neighbours of the secret, revealed after the round. */
  neighbours: { word: string; rank: number }[];
  entries: RoundSummaryEntry[];
  eliminated: string[];
}

export interface MatchResultEntry {
  playerId: string;
  displayName: string;
  avatarUrl: string | null;
  score: number;
  placement: number;
  wordsFound: number;
  totalGuesses: number;
  bestRank: number | null;
  ratingBefore: number | null;
  ratingAfter: number | null;
  xpGained: number;
}

export interface MatchResult {
  matchId: string;
  mode: GameMode;
  entries: MatchResultEntry[];
  rounds: RoundSummary[];
}

export interface FeedEntry {
  id: string;
  kind:
    | 'guess'
    | 'found'
    | 'join'
    | 'leave'
    | 'system'
    | 'chat'
    | 'emote'
    | 'hint'
    | 'eliminated';
  playerId: string | null;
  displayName: string | null;
  text: string;
  rank: number | null;
  band: RankBand | null;
  at: number;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  mode: GameMode;
  settings: GameSettings;
  hostId: string;
  players: RoomPlayer[];
  spectators: PublicUser[];
  round: number;
  totalRounds: number;
  /** Server epoch ms when the current phase ends. Null when untimed. */
  deadline: number | null;
  /** Server clock at broadcast time; the client uses it to correct drift. */
  now: number;
  /** Whose turn it is in turn-based modes. */
  activePlayerId: string | null;
  /** Populated after the round ends. */
  lastRound: RoundSummary | null;
  /** Public event log, newest last. */
  feed: FeedEntry[];
  /**
   * Quick-match lobbies run themselves: settings are fixed, and the match
   * starts on a timer once enough people are in rather than waiting on a host.
   * While that countdown is running `deadline` is when it fires.
   */
  autoStart: boolean;
  /** coop only. */
  teamGuessesLeft: number | null;
  /** Set once the match is over. */
  result: MatchResult | null;
}

/* ------------------------------------------------------------------ *
 * Leaderboards + profiles
 * ------------------------------------------------------------------ */

export type LeaderboardScope = 'global' | 'guild';
export type LeaderboardMetric = 'rating' | 'wins' | 'xp' | 'streak' | 'wordsFound';

export interface LeaderboardRow {
  rank: number;
  user: PublicUser;
  value: number;
  matches: number;
  wins: number;
  winRate: number;
  isMe: boolean;
}

export interface ProfileStats {
  user: PublicUser;
  level: number;
  xp: number;
  xpIntoLevel: number;
  xpForLevel: number;
  matches: number;
  wins: number;
  winRate: number;
  wordsFound: number;
  averageGuesses: number;
  fastestFindMs: number | null;
  currentStreak: number;
  bestStreak: number;
  perMode: { mode: GameMode; matches: number; wins: number; rating: number }[];
  recent: {
    matchId: string;
    mode: GameMode;
    placement: number;
    players: number;
    playedAt: number;
  }[];
  achievements: {
    id: string;
    name: string;
    description: string;
    icon: string;
    unlockedAt: number | null;
  }[];
}

export interface DailyChallengeState {
  date: string;
  guesses: GuessResult[];
  solved: boolean;
  guessCount: number;
  /** Placement among everyone who has solved it today. */
  standing: number | null;
  totalSolvers: number;
  bestGuessCount: number | null;
}

/* ------------------------------------------------------------------ *
 * Socket events
 * ------------------------------------------------------------------ */

export interface Ack<T> {
  ok: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface PublicRoomSummary {
  code: string;
  mode: GameMode;
  hostName: string;
  players: number;
  maxPlayers: number;
  phase: RoomPhase;
  difficulty: Difficulty;
  ranked: boolean;
}

export interface ClientToServerEvents {
  'room:create': (
    settings: Partial<GameSettings>,
    ack: (r: Ack<{ code: string }>) => void,
  ) => void;
  'room:join': (
    payload: { code: string; asSpectator?: boolean },
    ack: (r: Ack<{ code: string }>) => void,
  ) => void;
  'room:quickplay': (payload: { mode: GameMode }, ack: (r: Ack<{ code: string }>) => void) => void;
  /**
   * Join the room bound to this Discord activity instance, creating it if this
   * is the first person in the voice channel to open the Activity. This is the
   * zero-friction path: nobody types a code.
   */
  'room:joinInstance': (
    payload: { mode?: GameMode },
    ack: (r: Ack<{ code: string }>) => void,
  ) => void;
  'room:leave': (ack?: (r: Ack<null>) => void) => void;
  'room:settings': (patch: Partial<GameSettings>, ack?: (r: Ack<null>) => void) => void;
  'room:ready': (ready: boolean) => void;
  'room:start': (ack?: (r: Ack<null>) => void) => void;
  'room:kick': (payload: { playerId: string }, ack?: (r: Ack<null>) => void) => void;
  'room:transferHost': (payload: { playerId: string }, ack?: (r: Ack<null>) => void) => void;
  'room:rematch': (ack?: (r: Ack<null>) => void) => void;
  'game:guess': (payload: { word: string }, ack: (r: Ack<GuessResult>) => void) => void;
  'game:hint': (ack: (r: Ack<GuessResult>) => void) => void;
  'game:giveUp': () => void;
  'chat:send': (payload: { text: string }) => void;
  'emote:send': (payload: { emote: string }) => void;
  'lobby:list': (ack: (r: Ack<PublicRoomSummary[]>) => void) => void;
}

export interface ServerToClientEvents {
  session: (payload: { user: PublicUser }) => void;
  'room:state': (state: RoomState) => void;
  'room:closed': (payload: { reason: string }) => void;
  'game:guessResult': (result: GuessResult) => void;
  'game:feed': (entry: FeedEntry) => void;
  'round:start': (payload: { round: number; deadline: number | null; now: number }) => void;
  'round:end': (summary: RoundSummary) => void;
  'match:end': (result: MatchResult) => void;
  toast: (payload: { kind: 'info' | 'success' | 'warn' | 'error'; text: string }) => void;
  error: (payload: { code: string; message: string }) => void;
}
