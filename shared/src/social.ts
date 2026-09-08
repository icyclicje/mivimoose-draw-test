import type { GameMode, GuessResult, PublicUser } from './types.js';

/* ------------------------------------------------------------------ *
 * Friends
 * ------------------------------------------------------------------ */

export type FriendState = 'friend' | 'incoming' | 'outgoing';

export interface FriendSummary {
  user: PublicUser;
  state: FriendState;
  /** Online, and what they are doing, so "invite" can be offered or not. */
  online: boolean;
  /** Room code they are in, when they are in one you could join. */
  roomCode: string | null;
  activity: string | null;
  since: number;
}

export interface FriendList {
  friends: FriendSummary[];
  incoming: FriendSummary[];
  outgoing: FriendSummary[];
}

/** A room invite pushed straight to a friend who is online. */
export interface GameInvite {
  id: string;
  from: PublicUser;
  code: string;
  mode: GameMode;
  /** Epoch ms; invites go stale rather than piling up. */
  expiresAt: number;
}

/* ------------------------------------------------------------------ *
 * Match replay
 * ------------------------------------------------------------------ */

/**
 * The exact route one player took to a word, in the order they played it.
 *
 * This is the interesting artefact of a finished game, far more than the
 * final score, so it is a first-class thing you can open from the results
 * screen or from someone's profile.
 */
export interface GuessPath {
  user: PublicUser;
  round: number;
  secret: string;
  found: boolean;
  /** Ordered by when they were played, not by rank. */
  guesses: {
    word: string;
    rank: number;
    stolen: boolean;
    isHint: boolean;
    msIntoRound: number;
  }[];
  bestRank: number | null;
  totalGuesses: number;
}

export interface MatchReplay {
  matchId: string;
  mode: GameMode;
  playedAt: number;
  rounds: { index: number; secret: string }[];
  players: {
    user: PublicUser;
    placement: number;
    score: number;
    wordsFound: number;
    totalGuesses: number;
  }[];
  paths: GuessPath[];
}

/* ------------------------------------------------------------------ *
 * Live status messages
 * ------------------------------------------------------------------ */

/**
 * Short, transient lines the client surfaces over the board: "Ash is 12 away",
 * "you are getting warmer", "Wren found it". They are derived from game events
 * rather than stored, and they exist to make a quiet multiplayer round feel
 * like something is happening.
 */
export type StatusTone = 'neutral' | 'good' | 'great' | 'warn' | 'rival';

export interface StatusMessage {
  id: string;
  text: string;
  tone: StatusTone;
  /** ms the client should hold it on screen. */
  ttl: number;
  /** Higher wins when two land at once. */
  priority: number;
}

/* ------------------------------------------------------------------ *
 * Server statistics
 * ------------------------------------------------------------------ */

export type StatsRange = 'day' | 'week' | 'month';

export interface StatsPoint {
  /** Bucket start, epoch ms. */
  t: number;
  online: number;
  inGame: number;
  rooms: number;
}

export interface ServerStats {
  range: StatsRange;
  points: StatsPoint[];
  peak: { online: number; at: number };
  current: { online: number; inGame: number; rooms: number };
  totals: {
    players: number;
    matches: number;
    guesses: number;
    wordsFound: number;
  };
}

/** What a non-moderator is allowed to see: just the live headcount. */
export interface PublicPresence {
  online: number;
  inGame: number;
  rooms: number;
}
