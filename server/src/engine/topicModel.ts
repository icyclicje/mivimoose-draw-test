import { TOPICS } from '../data/topics.js';
import type { VectorSpace } from './vectors.js';

/**
 * Builds a small embedding space out of the bundled topic lists.
 *
 * Membership alone would make every word in a topic identical and every pair of
 * topics orthogonal, which plays terribly: you would get huge ties and no sense
 * of "warm but not hot". Two things fix that.
 *
 *  1. Smoothing. A word absorbs a fraction of the centroid of each topic it
 *     belongs to, repeatedly. Topics that share vocabulary bleed into each other,
 *     so `river` ends up nearer `bank` than `guitar` is, without anyone saying so.
 *  2. A tiny deterministic noise tail. Enough to order otherwise-identical words
 *     stably across restarts, small enough not to disturb real structure.
 */

const NOISE_DIM = 24;
const NOISE_SCALE = 0.035;
const SMOOTHING_PASSES = 3;
const SMOOTHING_ALPHA = [0.6, 0.4, 0.25];

function hash32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** xorshift32 — deterministic and fast; we only need stable jitter. */
function makeRng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

function normalize(v: Float32Array, offset: number, dim: number): void {
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += v[offset + i] * v[offset + i];
  const norm = Math.sqrt(sum) || 1;
  for (let i = 0; i < dim; i++) v[offset + i] /= norm;
}

export interface TopicModel extends VectorSpace {
  /** topic id -> member words, for the category filter and secret pools. */
  topicWords: Map<string, string[]>;
  wordTopics: Map<string, string[]>;
}

export function buildTopicModel(): TopicModel {
  const topicIds = TOPICS.map((t) => t[0]);
  const topicCount = topicIds.length;
  const dim = topicCount + NOISE_DIM;

  const topicWords = new Map<string, string[]>();
  const wordTopics = new Map<string, string[]>();
  const members: number[][] = []; // topic index -> word indices

  const wordIndex = new Map<string, number>();
  const words: string[] = [];

  const intern = (w: string): number => {
    let idx = wordIndex.get(w);
    if (idx === undefined) {
      idx = words.length;
      wordIndex.set(w, idx);
      words.push(w);
    }
    return idx;
  };

  TOPICS.forEach(([id, , wordList], t) => {
    const tokens = Array.from(
      new Set(
        wordList
          .split(/\s+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => w.length >= 2),
      ),
    );
    topicWords.set(id, tokens);
    const idxs: number[] = [];
    for (const token of tokens) {
      const wi = intern(token);
      idxs.push(wi);
      const list = wordTopics.get(token);
      if (list) list.push(id);
      else wordTopics.set(token, [id]);
    }
    members[t] = idxs;
  });

  const size = words.length;
  const data = new Float32Array(size * dim);

  // 1. Seed with topic membership, damped by topic size so a 22-word topic does
  //    not outweigh a 10-word one.
  TOPICS.forEach(([id], t) => {
    const idxs = members[t];
    const weight = 1 / Math.sqrt(idxs.length);
    for (const wi of idxs) data[wi * dim + t] = weight;
    void id;
  });

  // 2. Deterministic noise tail.
  for (let wi = 0; wi < size; wi++) {
    const rng = makeRng(hash32(words[wi]));
    for (let k = 0; k < NOISE_DIM; k++) {
      data[wi * dim + topicCount + k] = (rng() - 0.5) * 2 * NOISE_SCALE;
    }
    normalize(data, wi * dim, dim);
  }

  // 3. Smoothing passes. Words absorb their topics' centroids repeatedly, so
  //    topics that share vocabulary end up genuinely near one another.
  const centroid = new Float32Array(dim);
  for (let pass = 0; pass < SMOOTHING_PASSES; pass++) {
    const alpha = SMOOTHING_ALPHA[pass] ?? 0.2;
    const next = new Float32Array(data);
    for (let t = 0; t < topicCount; t++) {
      const idxs = members[t];
      if (!idxs.length) continue;
      centroid.fill(0);
      for (const wi of idxs) {
        const base = wi * dim;
        for (let i = 0; i < dim; i++) centroid[i] += data[base + i];
      }
      for (let i = 0; i < dim; i++) centroid[i] /= idxs.length;
      for (const wi of idxs) {
        const base = wi * dim;
        for (let i = 0; i < dim; i++) next[base + i] += alpha * centroid[i];
      }
    }
    data.set(next);
    for (let wi = 0; wi < size; wi++) normalize(data, wi * dim, dim);
  }

  // 4. Damp the noise tail now that the real structure is in place. Without
  //    this, two words from disjoint topics can out-rank genuinely related
  //    words purely on jitter, which reads as nonsense to a player.
  for (let wi = 0; wi < size; wi++) {
    const base = wi * dim;
    for (let k = 0; k < NOISE_DIM; k++) data[base + topicCount + k] *= 0.15;
    normalize(data, base, dim);
  }

  // Frequency proxy: words that show up in many topics are the common ones.
  // The lexicon uses this ordering for difficulty banding, exactly like the
  // frequency-sorted vocabulary you get from a real GloVe file.
  const order = words
    .map((w, i) => ({ w, i, t: (wordTopics.get(w) ?? []).length }))
    .sort((a, b) => b.t - a.t || a.w.length - b.w.length || a.w.localeCompare(b.w))
    .map((e) => e.w);

  return {
    provider: 'topic',
    dim,
    size,
    words: order,
    index: (word: string) => wordIndex.get(word) ?? -1,
    wordAt: (i: number) => words[i],
    vector: (i: number) => data.subarray(i * dim, i * dim + dim),
    raw: data,
    topicWords,
    wordTopics,
  };
}
