import fs from 'node:fs';
import path from 'node:path';
import { DIFFICULTY_BANDS, type Category, type Difficulty } from '@mivimoose/shared';
import { TOPICS } from '../data/topics.js';
import { STOPWORDS } from '../data/stopwords.js';
import { log } from '../log.js';
import { getVectorSpace, type VectorSpace } from './vectors.js';
import { isBlocked } from './wordFilter.js';

/**
 * Which words are allowed to be the answer.
 *
 * Guessing is open to the whole vector space — 200,000 words with a real GloVe
 * index. Answers come from a much tighter pool, because "the word of the day is
 * `pcmcia`" is not a game, and neither is `hospitals`.
 *
 * The pool is GloVe's frequency-ordered vocabulary passed through five filters:
 *
 *   1. A Hunspell dictionary (data/en.dic), restricted to its lowercase stems.
 *      This is the load-bearing filter. GloVe 6B is lowercased, so `rome` and
 *      `mohammed` are shaped exactly like common nouns and no amount of regex
 *      will tell them apart. Hunspell still carries the case: proper nouns are
 *      spelled `Jimmy/M`, common words `rookie/SM`. Keeping only the lowercase
 *      stems drops every proper noun in one step.
 *   2. A first-names list, as a second guard.
 *   3. Base-form preference. `hospitals`, `reporting` and `immensely` are all
 *      rejected because a shorter dictionary form of each is already in the
 *      pool. Answers should be lemmas; the inflections stay guessable.
 *   4. A frequency window, so answers are words people have actually met, with
 *      the two stopword tiers in data/stopwords.ts closing the gap the window
 *      is too shallow to reach — `time`, `people` and `thing` are common
 *      enough to sit deep in the vocabulary and still make thin answers.
 *   5. The blocklist in data/blocklist.ts: obscenity and slurs, which the
 *      Hunspell gate spells perfectly happily and would otherwise let through.
 *
 * With no vector index the bundled topic model supplies the vocabulary instead
 * and the same banding logic applies unchanged.
 */

/**
 * Answers are drawn from this slice of the frequency-ordered vocabulary. The
 * real gate is the Hunspell dictionary below, so this only has to keep answers
 * inside the range of words that actually show up in ordinary text.
 */
const SECRET_FREQUENCY_CEILING = 60_000;
/**
 * Skip the very top of the vocabulary outright. GloVe's first few hundred
 * tokens are articles, prepositions, bare auxiliaries and punctuation — none of
 * them answers, and being the most frequent words in English they would
 * otherwise anchor the easy band.
 */
const SECRET_FREQUENCY_FLOOR = 250;

/** Roman numerals, vowel runs, and triple-letter mashes make poor answers. */
const BAD_SECRET = /^(?:[ivxlcdm]+|[aeiou]{3,}|(.)\1{2,})$/;

export interface LexiconEntry {
  word: string;
  /** Position in the frequency-ordered vocabulary. */
  frequencyRank: number;
  /** 0 = most common in the pool, 1 = rarest. */
  commonality: number;
}

interface Lexicon {
  entries: LexiconEntry[];
  byWord: Map<string, LexiconEntry>;
  byDifficulty: Record<Difficulty, LexiconEntry[]>;
  /** Words explicitly tagged by the bundled topics, used as category seeds. */
  seedsByCategory: Map<Category, string[]>;
  dictionary: Set<string> | null;
}

/**
 * Hunspell stems, lowercase only. Lines look like `rookie/SM` or `roofless`;
 * anything starting with an uppercase letter is a proper noun and is dropped.
 */
function readHunspellStems(): Set<string> | null {
  const file = path.resolve(process.cwd(), 'data', 'en.dic');
  if (!fs.existsSync(file)) return null;
  const out = new Set<string>();
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const stem = line.split('/')[0].trim();
    if (/^[a-z]{2,20}$/.test(stem)) out.add(stem);
  }
  return out.size > 1000 ? out : null;
}

let lexicon: Lexicon | null = null;

/* ------------------------------------------------------------------ *
 * Word lists
 * ------------------------------------------------------------------ */

function readList(fileName: string, transform?: (w: string) => string): Set<string> | null {
  const file = path.resolve(process.cwd(), 'data', fileName);
  if (!fs.existsSync(file)) return null;
  const out = new Set<string>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const w = (transform ? transform(line) : line).trim();
    if (w) out.add(w);
  }
  return out;
}

function readExtraSecrets(): string[] {
  const file = path.resolve(process.cwd(), 'data', 'secrets.txt');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'));
}

/**
 * True when `word` is an inflected form of a shorter word that is itself a real
 * dictionary word. The length floors matter: without them `thing` reduces to
 * `the` and `ring` to `re`, and the pool loses perfectly good answers.
 *
 * Deliberately no `-er` rule — agent nouns like `player` and `teacher` are
 * words in their own right and make good answers.
 */
function isInflection(word: string, isBase: (w: string) => boolean): boolean {
  const ok = (base: string, minBase: number, minWord: number) =>
    word.length >= minWord && base.length >= minBase && isBase(base);

  if (word.endsWith('ies') && ok(`${word.slice(0, -3)}y`, 3, 5)) return true;
  if (word.endsWith('ves') && (ok(`${word.slice(0, -3)}f`, 3, 5) || ok(`${word.slice(0, -3)}fe`, 3, 5))) return true;
  if (/[^aeiou]es$/.test(word) && ok(word.slice(0, -2), 3, 5)) return true;
  if (/[^s]s$/.test(word) && ok(word.slice(0, -1), 3, 4)) return true;
  if (word.endsWith('ing') && (ok(word.slice(0, -3), 4, 6) || ok(`${word.slice(0, -3)}e`, 4, 6))) return true;
  if (word.endsWith('ed') && (ok(word.slice(0, -2), 4, 6) || ok(word.slice(0, -1), 4, 6))) return true;
  if (word.endsWith('ly') && ok(word.slice(0, -2), 4, 6)) return true;
  if (word.endsWith('est') && ok(word.slice(0, -3), 4, 6)) return true;

  const doubled = word.match(/^(.*[aeiou])([bdfglmnprt])\2(?:ing|ed)$/);
  if (doubled && ok(doubled[1] + doubled[2], 4, 6)) return true;

  return false;
}

function topicSeeds(): Map<Category, string[]> {
  const seeds = new Map<Category, string[]>();
  for (const [, category, words] of TOPICS) {
    const list = seeds.get(category) ?? [];
    for (const raw of words.split(/\s+/)) {
      const w = raw.trim().toLowerCase();
      if (w.length >= 3) list.push(w);
    }
    seeds.set(category, list);
  }
  return seeds;
}

function buildLexicon(): Lexicon {
  const space = getVectorSpace();
  const usingVectors = space.provider === 'vectors';

  // Hunspell is the primary gate; words_alpha is a broader fallback for
  // installations that only have that file.
  const hunspell = usingVectors ? readHunspellStems() : null;
  const dictionary = hunspell ?? (usingVectors ? readList('words_alpha.txt') : null);
  const names = usingVectors ? readList('firstnames.txt', (w) => w.toLowerCase()) : null;
  const extras = new Set(readExtraSecrets());

  if (usingVectors && !hunspell) {
    log.warn(
      'lexicon: data/en.dic is missing — proper nouns will leak into the answer pool. ' +
        'See the README for the one-line download.',
    );
  }

  const inVocab = (w: string) => space.index(w) >= 0;
  const isBase = dictionary
    ? (w: string) => dictionary.has(w) && inVocab(w)
    : (w: string) => inVocab(w);

  const candidates: string[] = [];
  space.words.forEach((word, frequencyRank) => {
    // Ahead of the extras branch on purpose: data/secrets.txt is an operator
    // convenience, not a way around the blocklist.
    if (isBlocked(word)) return;
    if (extras.has(word)) {
      candidates.push(word);
      return;
    }
    if (frequencyRank < SECRET_FREQUENCY_FLOOR) return;
    if (usingVectors && frequencyRank > SECRET_FREQUENCY_CEILING) return;
    if (!/^[a-z]{3,14}$/.test(word)) return;
    if (STOPWORDS.has(word)) return;
    if (BAD_SECRET.test(word)) return;
    if (dictionary && !dictionary.has(word)) return;
    if (names && names.has(word)) return;
    if (isInflection(word, isBase)) return;
    candidates.push(word);
  });

  const entries: LexiconEntry[] = candidates.map((word, i) => ({
    word,
    frequencyRank: space.index(word),
    commonality: candidates.length > 1 ? i / (candidates.length - 1) : 0,
  }));

  const byWord = new Map(entries.map((e) => [e.word, e]));

  const byDifficulty = {} as Record<Difficulty, LexiconEntry[]>;
  for (const [difficulty, band] of Object.entries(DIFFICULTY_BANDS)) {
    const slice = entries.filter((e) => e.commonality >= band.from && e.commonality <= band.to);
    byDifficulty[difficulty as Difficulty] = slice.length >= 50 ? slice : entries;
  }

  log.info(
    `lexicon: ${entries.length.toLocaleString()} answers from a ${space.size.toLocaleString()}-word vocabulary` +
      (hunspell ? ' (Hunspell filtered, lemmas only, no proper nouns)' : dictionary ? ' (dictionary filtered)' : ''),
  );

  return { entries, byWord, byDifficulty, seedsByCategory: topicSeeds(), dictionary };
}

export function getLexicon(): Lexicon {
  if (!lexicon) lexicon = buildLexicon();
  return lexicon;
}

/* ------------------------------------------------------------------ *
 * Categories
 *
 * Only ~1,800 words carry an explicit topic tag, far too few to filter a
 * 20,000-word answer pool. So the tags become seeds and the pool is scored
 * against them.
 *
 * Scoring is max-similarity to any single seed, NOT similarity to the seed
 * centroid. Averaging a few hundred nature words produces a vector that points
 * at "generic frequent English", and the resulting pool comes back as
 * `well, even, another, kind` for every category. Max-similarity asks the
 * question that actually matters: is this word close to *something* in the
 * category? `otter` is close to `animal`, and that is enough.
 * ------------------------------------------------------------------ */

const MAX_SEEDS = 80;
const categoryCache = new Map<Category, LexiconEntry[]>();

/** An evenly spread subset of the seeds, so one big topic cannot dominate. */
function seedIndices(category: Category, space: VectorSpace): number[] {
  const seeds = getLexicon().seedsByCategory.get(category) ?? [];
  const unique = [...new Set(seeds)].filter((w) => space.index(w) >= 0);
  if (unique.length <= MAX_SEEDS) return unique.map((w) => space.index(w));
  const step = unique.length / MAX_SEEDS;
  const picked: number[] = [];
  for (let i = 0; i < MAX_SEEDS; i++) picked.push(space.index(unique[Math.floor(i * step)]));
  return picked;
}

export function categoryPool(category: Category): LexiconEntry[] {
  const lex = getLexicon();
  if (category === 'any') return lex.entries;

  const cached = categoryCache.get(category);
  if (cached) return cached;

  const space = getVectorSpace();
  const seeds = seedIndices(category, space);
  if (seeds.length < 5) {
    categoryCache.set(category, lex.entries);
    return lex.entries;
  }

  const started = Date.now();
  const dim = space.dim;
  const raw = space.raw;

  const scored: { entry: LexiconEntry; score: number }[] = [];
  for (const entry of lex.entries) {
    const idx = space.index(entry.word);
    if (idx < 0) continue;
    const base = idx * dim;
    let best = -1;
    for (const seed of seeds) {
      const sBase = seed * dim;
      let dot = 0;
      for (let d = 0; d < dim; d++) dot += raw[base + d] * raw[sBase + d];
      if (dot > best) best = dot;
    }
    scored.push({ entry, score: best });
  }

  scored.sort((a, b) => b.score - a.score);
  const pool = scored.slice(0, Math.max(250, Math.floor(scored.length * 0.25))).map((s) => s.entry);

  log.info(`lexicon: built the "${category}" pool (${pool.length} words) in ${Date.now() - started}ms`);
  categoryCache.set(category, pool);
  return pool;
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededRandom(seed: string): () => number {
  let s = hashSeed(seed) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

export interface PickOptions {
  difficulty: Difficulty;
  category: Category;
  /** Words already used this match. */
  exclude?: Set<string>;
  /** Supplying a seed makes the whole match reproducible. */
  seed?: string | null;
  /** 0-based index within a seeded match. */
  nth?: number;
}

export function pickSecret(options: PickOptions): string {
  const lex = getLexicon();
  const { difficulty, category, exclude, seed, nth = 0 } = options;

  let pool = lex.byDifficulty[difficulty] ?? lex.entries;

  if (category !== 'any') {
    const inCategory = new Set(categoryPool(category).map((e) => e.word));
    const filtered = pool.filter((e) => inCategory.has(e.word));
    // Fall back rather than fail if a narrow category is thin at this difficulty.
    if (filtered.length >= 25) pool = filtered;
    else if (inCategory.size >= 25) pool = categoryPool(category);
  }

  const available = exclude?.size ? pool.filter((e) => !exclude.has(e.word)) : pool;
  const usable = available.length ? available : pool;

  const rng = seed ? seededRandom(`${seed}:${nth}`) : Math.random;
  return usable[Math.floor(rng() * usable.length)].word;
}

/** A whole match's worth of words, guaranteed distinct. */
export function pickSecrets(count: number, options: Omit<PickOptions, 'nth'>): string[] {
  const used = new Set(options.exclude ?? []);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const word = pickSecret({ ...options, exclude: used, nth: i });
    used.add(word);
    out.push(word);
  }
  return out;
}

/**
 * The daily should be winnable on a coffee break. It draws from the most
 * everyday eighth of the answer pool — still well over a thousand candidates,
 * so it is gentle without ever being guessable in advance.
 */
const DAILY_COMMONALITY_CEILING = 0.08;

let dailyPool: LexiconEntry[] | null = null;

function getDailyPool(): LexiconEntry[] {
  if (dailyPool) return dailyPool;
  const lex = getLexicon();
  const gentle = lex.entries.filter((e) => e.commonality <= DAILY_COMMONALITY_CEILING);
  dailyPool = gentle.length >= 200 ? gentle : (lex.byDifficulty.easy ?? lex.entries);
  return dailyPool;
}

/** Same word for everybody, every day, without storing a schedule. */
export function dailyWordFor(date: string): string {
  const pool = getDailyPool();
  const rng = seededRandom(`daily:${date}`);
  return pool[Math.floor(rng() * pool.length)].word;
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isPlayableSecret(word: string): boolean {
  return getLexicon().byWord.has(word);
}

export function lexiconStats() {
  const lex = getLexicon();
  return {
    answers: lex.entries.length,
    daily: getDailyPool().length,
    byDifficulty: Object.fromEntries(
      Object.entries(lex.byDifficulty).map(([k, v]) => [k, v.length]),
    ),
  };
}
