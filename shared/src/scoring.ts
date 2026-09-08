import type { RankBand } from './types.js';

/**
 * The heat scale, matching Contexto's: three bands, not a gradient.
 *
 * Thresholds are its own — green up to 300, orange up to 1500, pink beyond.
 * Players who know that game read these instantly.
 *
 * `color` is a CSS variable rather than a hex value so the bands follow the
 * active theme. Seven themes ship, three of them light and one deliberately
 * hueless, and a bar pinned to one fixed green would fight all of them. The
 * fallback in each var() is Contexto's own colour, so anything rendering these
 * outside the app's stylesheet still gets the right hue.
 */
export const BAND_THRESHOLDS: { band: RankBand; max: number; label: string; color: string }[] = [
  { band: 'found', max: 1, label: 'Found it', color: 'var(--band-hot, #00ba7c)' },
  { band: 'hot', max: 300, label: 'Hot', color: 'var(--band-hot, #00ba7c)' },
  { band: 'warm', max: 1500, label: 'Warm', color: 'var(--band-warm, #ef7d31)' },
  { band: 'cool', max: 15000, label: 'Cold', color: 'var(--band-cold, #f91880)' },
  { band: 'cold', max: 60000, label: 'Freezing', color: 'var(--band-cold, #f91880)' },
  {
    band: 'frozen',
    max: Number.POSITIVE_INFINITY,
    label: 'Nowhere near',
    color: 'var(--band-cold, #f91880)',
  },
];

export function bandForRank(rank: number): RankBand {
  for (const t of BAND_THRESHOLDS) if (rank <= t.max) return t.band;
  return 'frozen';
}

export function bandMeta(band: RankBand) {
  return BAND_THRESHOLDS.find((t) => t.band === band) ?? BAND_THRESHOLDS[BAND_THRESHOLDS.length - 1];
}

/**
 * How much of a guess row the colour bar fills, 0..1.
 *
 * Measured off contexto.me rather than guessed at: sampling its rendered bars
 * against their ranks gives width = exp(-rank / 800) with a 1% floor, and the
 * fitted constant came out at 800.3 across every sampled point. An exponential
 * is the right shape for this — it keeps the bar essentially empty across the
 * whole cold tail and only starts moving when you are genuinely close, which is
 * exactly the feedback the game wants to give.
 *
 * Tau is scaled a little for our deeper 200k-word list so the feel matches at
 * a vocabulary 2.5x the size.
 */
const HEAT_TAU = 1000;

export function heatFraction(rank: number): number {
  if (rank <= 1) return 1;
  return Math.max(0.01, Math.exp(-rank / HEAT_TAU));
}

/**
 * Log-scaled 0..1 closeness, used for scoring rather than display.
 *
 * Points want a gentler curve than the bar does: a player who claws from rank
 * 40,000 to rank 3,000 has made real progress and should be paid for it, even
 * though `heatFraction` still shows an empty bar at both.
 */
export function rankProgress(rank: number, depth = 200000): number {
  if (rank <= 1) return 1;
  const clamped = Math.min(rank, depth);
  return Math.max(0, Math.min(1, 1 - Math.log(clamped) / Math.log(depth)));
}

/* ------------------------------------------------------------------ *
 * Round scoring
 * ------------------------------------------------------------------ */

export interface RoundScoreInput {
  bestRank: number | null;
  found: boolean;
  /** ms into the round when the word was found. */
  foundAt: number | null;
  roundMs: number;
  guessCount: number;
  /** 1-indexed finishing position within the round. */
  placement: number;
  playerCount: number;
  hintsUsed: number;
}

/**
 * Points are dominated by how close you got, with a real but not decisive
 * bonus for being fast. That keeps a 60-second Blitz round meaningful even
 * when nobody actually lands the word.
 */
export function scoreRound(input: RoundScoreInput): number {
  const { bestRank, found, foundAt, roundMs, guessCount, placement, playerCount, hintsUsed } = input;
  if (bestRank === null) return 0;

  let points = Math.round(1000 * rankProgress(bestRank));

  if (found) {
    points += 500;
    if (roundMs > 0 && foundAt !== null) {
      const speed = Math.max(0, 1 - foundAt / roundMs);
      points += Math.round(400 * speed);
    }
    // Efficiency: solving in few guesses is worth more than brute force.
    const efficiency = Math.max(0, 1 - Math.min(guessCount, 60) / 60);
    points += Math.round(200 * efficiency);
  }

  if (playerCount > 1) {
    const placementBonus = Math.round((250 * (playerCount - placement)) / (playerCount - 1));
    points += Math.max(0, placementBonus);
  }

  points -= hintsUsed * 120;
  return Math.max(0, points);
}

/* ------------------------------------------------------------------ *
 * Elo
 * ------------------------------------------------------------------ */

export const BASE_RATING = 1000;

function kFactor(rating: number, matches: number): number {
  if (matches < 15) return 48;
  if (rating > 1900) return 16;
  if (rating > 1500) return 24;
  return 32;
}

export interface RatingInput {
  playerId: string;
  rating: number;
  matches: number;
  /** 1-indexed final placement. Ties share a placement. */
  placement: number;
}

/**
 * Multiplayer Elo via pairwise comparison: each player is scored against every
 * other player in the lobby and the deltas are averaged, so a 10-player win is
 * worth more than beating one opponent but never ten times as much.
 */
export function computeRatingDeltas(players: RatingInput[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (players.length < 2) {
    for (const p of players) out[p.playerId] = 0;
    return out;
  }

  for (const p of players) {
    let delta = 0;
    for (const q of players) {
      if (q.playerId === p.playerId) continue;
      const expected = 1 / (1 + Math.pow(10, (q.rating - p.rating) / 400));
      const actual = p.placement < q.placement ? 1 : p.placement > q.placement ? 0 : 0.5;
      delta += kFactor(p.rating, p.matches) * (actual - expected);
    }
    out[p.playerId] = Math.round(delta / (players.length - 1));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * XP and levels
 * ------------------------------------------------------------------ */

/** XP needed to advance out of a given level. Gently superlinear. */
export function xpForLevel(level: number): number {
  return Math.round(150 * Math.pow(level, 1.35));
}

export function levelFromXp(totalXp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  for (;;) {
    const needed = xpForLevel(level);
    if (remaining < needed || level >= 200) return { level, into: remaining, needed };
    remaining -= needed;
    level += 1;
  }
}

export function xpForMatch(score: number, placement: number, playerCount: number): number {
  const base = Math.round(score / 8);
  const podium = placement === 1 ? 60 : placement === 2 ? 35 : placement === 3 ? 20 : 10;
  const lobbyBonus = Math.round(playerCount * 3);
  return base + podium + lobbyBonus;
}

/* ------------------------------------------------------------------ *
 * Achievements
 * ------------------------------------------------------------------ */

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-blood', name: 'First Blood', description: 'Win your first match.', icon: 'trophy' },
  { id: 'one-shot', name: 'One Shot', description: 'Find a word on your first guess.', icon: 'crosshair' },
  { id: 'sniper', name: 'Sniper', description: 'Find a word in five guesses or fewer.', icon: 'target' },
  { id: 'speed-demon', name: 'Speed Demon', description: 'Find a word in under fifteen seconds.', icon: 'bolt' },
  { id: 'thief', name: 'Word Thief', description: 'Steal fifty words already claimed by an opponent.', icon: 'hand' },
  { id: 'duelist', name: 'Duelist', description: 'Win ten ranked duels.', icon: 'swords' },
  { id: 'survivor', name: 'Sole Survivor', description: 'Win an elimination match from a full lobby.', icon: 'skull' },
  { id: 'marathoner', name: 'Marathoner', description: 'Finish every round of a Marathon in the top three.', icon: 'route' },
  { id: 'daily-devotee', name: 'Devotee', description: 'Solve the daily word seven days running.', icon: 'calendar' },
  { id: 'centurion', name: 'Centurion', description: 'Find one hundred words.', icon: 'medal' },
  { id: 'polyglot', name: 'Polyglot', description: 'Win at least once in every game mode.', icon: 'globe' },
  { id: 'cold-blooded', name: 'Cold Blooded', description: 'Win a round without a single guess under rank 500.', icon: 'snowflake' },
];
