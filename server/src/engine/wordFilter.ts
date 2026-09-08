import fs from 'node:fs';
import path from 'node:path';
import { BLOCKED_PATTERNS, BLOCKLIST, EXEMPT } from '../data/blocklist.js';
import { COMMON_WORDS, FUNCTION_WORDS } from '../data/stopwords.js';
import { log } from '../log.js';

/**
 * Whether a word is fit to appear in the game.
 *
 * Two independent questions, because they have different answers on the two
 * sides of a round:
 *
 *   isBlocked     — obscenity and slurs. Never an answer, never a hint, never
 *                   a reveal, never an accepted guess.
 *   isTooCommon   — function words and semantically thin filler. Never an
 *                   answer; guessing is only barred for the function words,
 *                   which is what `forGuess` selects.
 */

/**
 * Regular suffixes to peel before looking a word up, so one base form in the
 * blocklist covers its whole family. Order matters: longest first, and each
 * rule is tried against the original word rather than a previous result, so
 * nothing compounds its way into a false positive.
 */
const SUFFIXES = ['iness', 'ingly', 'edly', 'ings', 'ing', 'ies', 'ers', 'est', 'ed', 'er', 'es', 'ly', 's', 'y'];

/**
 * Suffixes that swallow a silent `e`, so `raping` has to be tried as `rape`.
 * Bare `-s` is pointedly not one of them: it never eats an `e`, and letting it
 * try turns `raps` into `rape` and `pubs` into `pube`.
 */
const DROPS_SILENT_E = new Set(['ing', 'ings', 'ingly', 'ed', 'edly', 'er', 'ers', 'est', 'y', 'iness', 'ies']);

let extraBlocked: Set<string> | null = null;

/**
 * Operator additions, one word per line, `#` for comments. Lives in the same
 * `data/` directory as the word lists, which on a deployment is the persistent
 * volume — so a word can be banned without a redeploy.
 */
function getExtraBlocked(): Set<string> {
  if (extraBlocked) return extraBlocked;
  extraBlocked = new Set<string>();
  const file = path.resolve(process.cwd(), 'data', 'blocked.txt');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const w = line.trim().toLowerCase();
      if (w && !w.startsWith('#')) extraBlocked.add(w);
    }
    if (extraBlocked.size) log.info(`wordfilter: ${extraBlocked.size} extra blocked words from data/blocked.txt`);
  }
  return extraBlocked;
}

const blocked = new Set(BLOCKLIST);
const cache = new Map<string, boolean>();

function matches(word: string): boolean {
  if (EXEMPT.has(word)) return false;
  if (blocked.has(word) || getExtraBlocked().has(word)) return true;
  return BLOCKED_PATTERNS.some((p) => p.test(word));
}

/** Obscenity or a slur, in any regular inflection of it. */
export function isBlocked(word: string): boolean {
  const w = word.toLowerCase();
  const hit = cache.get(w);
  if (hit !== undefined) return hit;

  // Not the same check as the one inside matches(): this one also skips the
  // suffix pass below, which is the whole point — `spicy` only survives if it
  // is never reduced to `spic`.
  if (EXEMPT.has(w)) {
    cache.set(w, false);
    return false;
  }

  let result = matches(w);
  if (!result) {
    for (const suffix of SUFFIXES) {
      if (w.length <= suffix.length + 2 || !w.endsWith(suffix)) continue;
      const stem = w.slice(0, -suffix.length);
      // `shitty` -> `shitt` -> `shit`, `wanking` -> `wank`.
      const undoubled = /([bdfglmnprt])\1$/.test(stem) ? stem.slice(0, -1) : null;
      const silentE = DROPS_SILENT_E.has(suffix) && matches(`${stem}e`);
      if (matches(stem) || (undoubled && matches(undoubled)) || silentE) {
        result = true;
        break;
      }
    }
  }

  cache.set(w, result);
  return result;
}

/**
 * Too common to be worth guessing at. `forGuess` narrows this to the function
 * words: barring `time` or `people` as an answer keeps rounds interesting, but
 * barring them as a guess would take away a normal opening probe.
 */
export function isTooCommon(word: string, forGuess = false): boolean {
  const w = word.toLowerCase();
  return FUNCTION_WORDS.has(w) || (!forGuess && COMMON_WORDS.has(w));
}

/** Fit to be an answer, a hint, or a word revealed on the board. */
export function isAllowedWord(word: string): boolean {
  return !isBlocked(word) && !isTooCommon(word);
}
