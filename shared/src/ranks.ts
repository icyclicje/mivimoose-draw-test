/**
 * Competitive tiers.
 *
 * Elo on its own is a number nobody feels anything about. A tier gives it a
 * name, a colour and a shape, and (more usefully) tells you how far you are
 * from the next one, which is the thing that actually pulls people back.
 *
 * Bands are deliberately uneven: narrow at the bottom so new players move
 * quickly and see progress, wide at the top so the last tier means something.
 */

export interface RankTier {
  id: string;
  name: string;
  /** Key into the client's icon set. */
  icon: string;
  /** A theme token, not a literal colour, so tiers follow the active theme. */
  color: string;
  minRating: number;
}

export const RANK_TIERS: RankTier[] = [
  { id: 'drifter', name: 'Drifter', icon: 'feather', color: 'var(--text-faint)', minRating: 0 },
  { id: 'novice', name: 'Novice', icon: 'seed', color: 'var(--text-dim)', minRating: 900 },
  { id: 'reader', name: 'Reader', icon: 'book', color: 'var(--green)', minRating: 1025 },
  { id: 'scout', name: 'Scout', icon: 'compass', color: 'var(--accent)', minRating: 1150 },
  { id: 'tracker', name: 'Tracker', icon: 'route', color: 'var(--accent)', minRating: 1275 },
  { id: 'adept', name: 'Adept', icon: 'spark', color: 'var(--orange)', minRating: 1400 },
  { id: 'oracle', name: 'Oracle', icon: 'target', color: 'var(--orange)', minRating: 1550 },
  { id: 'sage', name: 'Sage', icon: 'crown', color: 'var(--brand)', minRating: 1700 },
  { id: 'lexicon', name: 'Lexicon', icon: 'trophy', color: 'var(--pink)', minRating: 1900 },
];

export function tierForRating(rating: number): RankTier {
  let found = RANK_TIERS[0];
  for (const tier of RANK_TIERS) if (rating >= tier.minRating) found = tier;
  return found;
}

/** The next tier up, and how much rating is still needed. Null at the ceiling. */
export function nextTier(rating: number): { tier: RankTier; ratingNeeded: number } | null {
  const upcoming = RANK_TIERS.find((t) => t.minRating > rating);
  return upcoming ? { tier: upcoming, ratingNeeded: upcoming.minRating - rating } : null;
}

/** 0..1 through the current tier. Sits at 1 for anyone in the top band. */
export function tierProgress(rating: number): number {
  const current = tierForRating(rating);
  const upcoming = RANK_TIERS.find((t) => t.minRating > rating);
  if (!upcoming) return 1;
  const span = upcoming.minRating - current.minRating;
  return span > 0 ? Math.min(1, Math.max(0, (rating - current.minRating) / span)) : 0;
}
