import fs from 'node:fs';
import path from 'node:path';
import { env } from '../env.js';
import { log } from '../log.js';
import { buildTopicModel } from './topicModel.js';

/**
 * A loaded embedding space. Two implementations satisfy it:
 *
 *  - `vectors`: a binary index built from GloVe or word2vec by
 *    `npm run build:index`. This is what you want in production — real
 *    co-occurrence statistics over billions of tokens, which is exactly what
 *    Contexto's ranking is derived from.
 *  - `topic`: the bundled offline model. Always available, no download.
 */
export interface VectorSpace {
  readonly provider: 'vectors' | 'topic';
  readonly dim: number;
  readonly size: number;
  /** Vocabulary in descending frequency order. Drives difficulty banding. */
  words: string[];
  index(word: string): number;
  wordAt(i: number): string;
  vector(i: number): Float32Array;
  /** Flat row-major store, used by the ranker's hot loop. */
  raw: Float32Array;
}

export const INDEX_MAGIC = 'ARNAVEC2';

/**
 * Binary layout, all little-endian:
 *   [0..8)    magic "ARNAVEC2"
 *   [8..12)   uint32 dim
 *   [12..16)  uint32 count
 *   [16..20)  uint32 vocabBytes (padded to a 4-byte boundary)
 *   [20..)    vocab, words joined by "\n", utf8, zero padded
 *   then      count * dim float32, L2 normalised
 */
export function loadBinaryIndex(file: string): VectorSpace {
  const buf = fs.readFileSync(file);
  const magic = buf.subarray(0, 8).toString('ascii');
  if (magic !== INDEX_MAGIC) {
    throw new Error(`${file} is not a vector index (magic was "${magic}")`);
  }
  const dim = buf.readUInt32LE(8);
  const count = buf.readUInt32LE(12);
  const vocabBytes = buf.readUInt32LE(16);
  const vocabStart = 20;
  const dataStart = vocabStart + vocabBytes;

  const words = buf
    .subarray(vocabStart, vocabStart + vocabBytes)
    .toString('utf8')
    .replace(/\0+$/, '')
    .split('\n');

  if (words.length !== count) {
    throw new Error(`vector index is corrupt: ${words.length} words for ${count} rows`);
  }

  const expected = count * dim * 4;
  const available = buf.byteLength - dataStart;
  if (available < expected) {
    throw new Error(`vector index is truncated: need ${expected} data bytes, have ${available}`);
  }

  // Copy rather than aliasing the Buffer: Float32Array demands 4-byte alignment
  // and Node's pooled Buffers make no such promise.
  const raw = new Float32Array(count * dim);
  Buffer.from(raw.buffer).set(buf.subarray(dataStart, dataStart + expected));

  const lookup = new Map<string, number>();
  for (let i = 0; i < words.length; i++) lookup.set(words[i], i);

  return {
    provider: 'vectors',
    dim,
    size: count,
    words,
    index: (w) => lookup.get(w) ?? -1,
    wordAt: (i) => words[i],
    vector: (i) => raw.subarray(i * dim, i * dim + dim),
    raw,
  };
}

let cached: VectorSpace | null = null;

export function getVectorSpace(): VectorSpace {
  if (cached) return cached;

  const wanted = env.EMBEDDING_PROVIDER;
  const indexPath = path.isAbsolute(env.VECTOR_INDEX_PATH)
    ? env.VECTOR_INDEX_PATH
    : path.resolve(process.cwd(), env.VECTOR_INDEX_PATH);

  if (wanted === 'vectors' || wanted === 'auto') {
    if (fs.existsSync(indexPath)) {
      try {
        const started = Date.now();
        cached = loadBinaryIndex(indexPath);
        log.info(
          `embeddings: loaded ${cached.size.toLocaleString()} words x ${cached.dim}d from ${path.basename(indexPath)} in ${Date.now() - started}ms`,
        );
        return cached;
      } catch (err) {
        log.error(`embeddings: failed to read ${indexPath}`, err);
        if (wanted === 'vectors') throw err;
      }
    } else if (wanted === 'vectors') {
      throw new Error(
        `EMBEDDING_PROVIDER=vectors but ${indexPath} does not exist. Run "npm run build:index" first.`,
      );
    }
  }

  const started = Date.now();
  cached = buildTopicModel();
  log.info(
    `embeddings: built the bundled topic model (${cached.size.toLocaleString()} words x ${cached.dim}d) in ${Date.now() - started}ms`,
  );
  log.info('embeddings: run "npm run build:index" with a GloVe file for full-fat semantics');
  return cached;
}

/** Test seam. */
export function __setVectorSpace(space: VectorSpace | null) {
  cached = space;
}
