import type { GuessResult } from './types.js';

/**
 * The copy-pasteable daily result.
 *
 * Wordle's trick was never the grid, it was that the grid says how the game
 * went without saying a single word of the answer. Same rule here: we show how
 * many guesses landed in each heat tier and nothing else, so pasting it into a
 * group chat spoils nothing for anyone who has not played yet.
 */

const TIERS = [
  { emoji: '🟩', label: 'close', max: 300 },
  { emoji: '🟧', label: 'warm', max: 1500 },
  { emoji: '🟥', label: 'cold', max: Number.POSITIVE_INFINITY },
] as const;

/** Rows never run past this, so the paste stays readable in a chat window. */
const MAX_BLOCKS = 10;

export interface DailyShareInput {
  date: string;
  guesses: GuessResult[];
  solved: boolean;
  /** Placement among today's solvers, when known. */
  standing?: number | null;
  /** Appended as the last line when supplied. */
  url?: string | null;
}

export function buildDailyShare({
  date,
  guesses,
  solved,
  standing,
  url,
}: DailyShareInput): string {
  const counts = TIERS.map(
    (tier, i) =>
      guesses.filter((g) => {
        const floor = i === 0 ? 0 : TIERS[i - 1].max;
        return g.rank > floor && g.rank <= tier.max;
      }).length,
  );

  const lines: string[] = [`Mivimoose Guess · ${date}`];

  lines.push(
    solved
      ? `Found it in ${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'}${
          standing ? ` · #${standing} today` : ''
        }`
      : `${guesses.length} ${guesses.length === 1 ? 'guess' : 'guesses'} deep, still hunting`,
  );

  lines.push('');

  for (let i = 0; i < TIERS.length; i++) {
    const count = counts[i];
    if (!count) continue;
    const shown = Math.min(count, MAX_BLOCKS);
    const overflow = count - shown;
    lines.push(TIERS[i].emoji.repeat(shown) + (overflow > 0 ? ` +${overflow}` : ''));
  }

  if (url) {
    lines.push('');
    lines.push(url);
  }

  return lines.join('\n');
}

/** Same tier counts the share string uses, for rendering a legend beside it. */
export function dailyTierBreakdown(guesses: GuessResult[]) {
  return TIERS.map((tier, i) => {
    const floor = i === 0 ? 0 : TIERS[i - 1].max;
    return {
      emoji: tier.emoji,
      label: tier.label,
      count: guesses.filter((g) => g.rank > floor && g.rank <= tier.max).length,
    };
  });
}
