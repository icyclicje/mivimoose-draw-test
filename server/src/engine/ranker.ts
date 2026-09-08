import { env } from '../env.js';
import { log } from '../log.js';
import { getVectorSpace, type VectorSpace } from './vectors.js';
import { isAllowedWord } from './wordFilter.js';

/**
 * A full ranking of the lexicon against one secret word.
 *
 * Ranks live in an Int32Array keyed by vocabulary index rather than a Map of
 * strings. A 60k-word Map costs several megabytes per secret and we keep dozens
 * of these cached; the typed array is 240KB and the lookup is a single load.
 */
export interface RankTable {
  secret: string;
  secretIndex: number;
  depth: number;
  /** 1-based rank per vocabulary index. 0 means "outside the ranked list". */
  rankByIndex: Int32Array;
  /** Vocabulary index per rank, so rank -> word is O(1) too. */
  indexByRank: Int32Array;
  builtAt: number;
  buildMs: number;
}

// Each cached table is two Int32Arrays over the vocabulary: ~1.6MB at a 200k
// vocabulary. Twelve is enough to cover a ten-round match plus the lookahead
// precompute without holding 100MB of rank tables.
const MAX_CACHED_TABLES = 12;
const cache = new Map<string, RankTable>();

function touch(key: string, table: RankTable) {
  cache.delete(key);
  cache.set(key, table);
  while (cache.size > MAX_CACHED_TABLES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * Cosine similarity against every word in the ranked slice, sorted descending.
 * Vectors are stored L2-normalised so cosine is a plain dot product.
 */
export function buildRankTable(secret: string, space: VectorSpace = getVectorSpace()): RankTable {
  const secretIndex = space.index(secret);
  if (secretIndex < 0) throw new Error(`"${secret}" is not in the lexicon`);

  const started = Date.now();
  const depth = Math.min(env.RANK_DEPTH, space.size);
  const dim = space.dim;
  const raw = space.raw;
  const base = secretIndex * dim;

  const scores = new Float32Array(depth);
  for (let i = 0; i < depth; i++) {
    const off = i * dim;
    let dot = 0;
    for (let d = 0; d < dim; d++) dot += raw[base + d] * raw[off + d];
    scores[i] = dot;
  }

  const order = new Int32Array(depth);
  for (let i = 0; i < depth; i++) order[i] = i;
  // Ties break on vocabulary index, which is frequency order — deterministic
  // across restarts and slightly friendlier than an arbitrary order.
  const sorted = Array.from(order).sort((a, b) => scores[b] - scores[a] || a - b);

  const rankByIndex = new Int32Array(space.size);
  const indexByRank = new Int32Array(depth + 1);
  for (let r = 0; r < sorted.length; r++) {
    rankByIndex[sorted[r]] = r + 1;
    indexByRank[r + 1] = sorted[r];
  }

  const table: RankTable = {
    secret,
    secretIndex,
    depth,
    rankByIndex,
    indexByRank,
    builtAt: Date.now(),
    buildMs: Date.now() - started,
  };
  return table;
}

export function getRankTable(secret: string): RankTable {
  const key = secret.toLowerCase();
  const hit = cache.get(key);
  if (hit) {
    touch(key, hit);
    return hit;
  }
  const table = buildRankTable(key);
  if (table.buildMs > 250) {
    log.warn(`ranker: building "${key}" took ${table.buildMs}ms`);
  }
  touch(key, table);
  return table;
}

/** Warm the cache off the request path so the first guess of a round is instant. */
export function precomputeRankTable(secret: string): void {
  setImmediate(() => {
    try {
      getRankTable(secret);
    } catch (err) {
      log.error(`ranker: precompute failed for "${secret}"`, err);
    }
  });
}

/* ------------------------------------------------------------------ *
 * Guess normalisation
 * ------------------------------------------------------------------ */

const SUFFIX_RULES: [RegExp, string][] = [
  [/ies$/, 'y'],
  [/ves$/, 'f'],
  [/([^aeiou])es$/, '$1'],
  [/([^s])s$/, '$1'],
  [/ing$/, ''],
  [/ing$/, 'e'],
  [/ed$/, ''],
  [/ed$/, 'e'],
  [/er$/, ''],
  [/est$/, ''],
  [/ly$/, ''],
];

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export interface ResolvedWord {
  /** The vocabulary form we actually ranked. */
  word: string;
  index: number;
  /** Set when we had to fall back to a base form, e.g. "cats" -> "cat". */
  normalizedFrom: string | null;
}

/**
 * Turn raw player input into a vocabulary entry. Exact matches win; otherwise we
 * try a handful of English suffix rules so plurals and simple conjugations are
 * not rejected as unknown words. We never invent a form that is not itself in
 * the lexicon.
 */
export function resolveWord(input: string, space: VectorSpace = getVectorSpace()): ResolvedWord | null {
  const cleaned = stripDiacritics(input.trim().toLowerCase()).replace(/[^a-z'-]/g, '');
  if (!cleaned) return null;

  const direct = space.index(cleaned);
  if (direct >= 0) return { word: cleaned, index: direct, normalizedFrom: null };

  for (const [pattern, replacement] of SUFFIX_RULES) {
    if (!pattern.test(cleaned)) continue;
    const candidate = cleaned.replace(pattern, replacement);
    if (candidate.length < 2 || candidate === cleaned) continue;
    const idx = space.index(candidate);
    if (idx >= 0) return { word: candidate, index: idx, normalizedFrom: cleaned };
  }

  // Doubled consonant before -ing/-ed: "running" -> "run".
  const doubled = cleaned.match(/^(.*?)([bdfglmnprt])\2(ing|ed)$/);
  if (doubled) {
    const candidate = doubled[1] + doubled[2];
    const idx = space.index(candidate);
    if (idx >= 0) return { word: candidate, index: idx, normalizedFrom: cleaned };
  }

  return null;
}

export function rankOf(table: RankTable, index: number): number | null {
  const rank = table.rankByIndex[index];
  return rank > 0 ? rank : null;
}

export function wordAtRank(table: RankTable, rank: number): string | null {
  if (rank < 1 || rank > table.depth) return null;
  const space = getVectorSpace();
  return space.wordAt(table.indexByRank[rank]);
}

/** The nearest neighbours, used for the post-round reveal. */
export function neighboursOf(table: RankTable, count = 12): { word: string; rank: number }[] {
  const space = getVectorSpace();
  const out: { word: string; rank: number }[] = [];
  for (let r = 2; r <= table.depth && out.length < count; r++) {
    const word = space.wordAt(table.indexByRank[r]);
    // A reveal is the one place the game prints words nobody chose, so it is
    // also the easiest place for an obscenity to surface next to the answer.
    if (!isAllowedWord(word)) continue;
    out.push({ word, rank: r });
  }
  return out;
}

/**
 * Pick a hint: a word meaningfully closer than the player's current best, but
 * never the answer itself. Landing roughly a quarter of the way in keeps hints
 * useful without handing over the round.
 */
export function pickHint(
  table: RankTable,
  currentBest: number | null,
  exclude: Set<string>,
): { word: string; rank: number } | null {
  const space = getVectorSpace();
  const ceiling = currentBest && currentBest > 2 ? currentBest : Math.min(table.depth, 900);
  const target = Math.max(2, Math.floor(ceiling / 4));

  for (let spread = 0; spread < 400; spread++) {
    for (const rank of [target + spread, target - spread]) {
      if (rank < 2 || rank > table.depth) continue;
      const word = space.wordAt(table.indexByRank[rank]);
      if (!exclude.has(word) && isAllowedWord(word)) return { word, rank };
    }
  }
  return null;
}

export function rankerStats() {
  const space = getVectorSpace();
  return {
    provider: space.provider,
    vocabulary: space.size,
    dimensions: space.dim,
    depth: Math.min(env.RANK_DEPTH, space.size),
    cachedTables: cache.size,
  };
}
