/**
 * Turns a GloVe / word2vec text file into the compact binary index the game
 * loads at boot.
 *
 *   npm run build:index -- --input ./data/glove.6B.300d.txt
 *   npm run build:index -- --input ./data/vectors.txt --limit 120000 --output ./data/index.bin
 *
 * Where to get vectors:
 *   GloVe 6B (822MB zip, includes 50/100/200/300d)
 *     https://nlp.stanford.edu/data/glove.6B.zip
 *   GloVe 42B 300d (1.75GB zip, noticeably better rankings)
 *     https://nlp.stanford.edu/data/glove.42B.300d.zip
 *
 * Unzip it into server/data/ and point --input at the .txt.
 *
 * The input is expected to be frequency ordered, which GloVe files are. That
 * ordering is preserved in the index and is what the difficulty bands slice.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { INDEX_MAGIC } from '../src/engine/vectors.js';

interface Args {
  input: string;
  output: string;
  limit: number;
  minLength: number;
  maxLength: number;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const input = get('--input');
  if (!input) {
    console.error('Usage: npm run build:index -- --input ./data/glove.6B.300d.txt [--limit 100000]');
    process.exit(1);
  }
  return {
    input: path.resolve(process.cwd(), input),
    output: path.resolve(process.cwd(), get('--output', './data/index.bin')!),
    limit: Number(get('--limit', '100000')),
    minLength: Number(get('--min-length', '2')),
    maxLength: Number(get('--max-length', '20')),
  };
}

/**
 * Keep ordinary lowercase words. GloVe's head is full of punctuation, numbers,
 * URLs and proper nouns; none of them make a good ranking neighbour and they
 * bloat the index.
 */
function isPlayable(word: string, args: Args): boolean {
  if (word.length < args.minLength || word.length > args.maxLength) return false;
  if (!/^[a-z][a-z'-]*[a-z]$|^[a-z]$/.test(word)) return false;
  if (/--/.test(word)) return false;
  return true;
}

async function main() {
  const args = parseArgs();
  if (!fs.existsSync(args.input)) {
    console.error(`No such file: ${args.input}`);
    process.exit(1);
  }

  console.log(`Reading ${args.input}`);
  const stream = fs.createReadStream(args.input, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const words: string[] = [];
  const vectors: Float32Array[] = [];
  let dim = 0;
  let seen = 0;
  let skippedHeader = false;

  for await (const line of lines) {
    if (!line.trim()) continue;
    seen++;

    // word2vec text format opens with "<count> <dim>".
    if (!skippedHeader && /^\d+\s+\d+$/.test(line.trim())) {
      skippedHeader = true;
      continue;
    }
    skippedHeader = true;

    const firstSpace = line.indexOf(' ');
    if (firstSpace <= 0) continue;
    const word = line.slice(0, firstSpace);
    if (!isPlayable(word, args)) continue;

    const parts = line.slice(firstSpace + 1).split(' ');
    if (!dim) dim = parts.length;
    if (parts.length !== dim) continue;

    const vec = new Float32Array(dim);
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      const v = Number.parseFloat(parts[i]);
      vec[i] = v;
      sumSq += v * v;
    }
    // Store L2-normalised so ranking is a plain dot product at runtime.
    const norm = Math.sqrt(sumSq) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;

    words.push(word);
    vectors.push(vec);

    if (words.length % 25000 === 0) {
      console.log(`  kept ${words.length.toLocaleString()} of ${seen.toLocaleString()} lines`);
    }
    if (words.length >= args.limit) break;
  }

  if (!words.length) {
    console.error('No usable rows. Is this really a GloVe/word2vec text file?');
    process.exit(1);
  }

  console.log(`Kept ${words.length.toLocaleString()} words at ${dim} dimensions`);

  const vocabRaw = Buffer.from(words.join('\n'), 'utf8');
  // Pad so the float payload starts on a 4-byte boundary.
  const padding = (4 - (vocabRaw.byteLength % 4)) % 4;
  const vocab = Buffer.concat([vocabRaw, Buffer.alloc(padding)]);

  const header = Buffer.alloc(20);
  header.write(INDEX_MAGIC, 0, 'ascii');
  header.writeUInt32LE(dim, 8);
  header.writeUInt32LE(words.length, 12);
  header.writeUInt32LE(vocab.byteLength, 16);

  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  const out = fs.createWriteStream(args.output);
  out.write(header);
  out.write(vocab);

  const rowBytes = dim * 4;
  const chunk = Buffer.alloc(rowBytes * 512);
  let offset = 0;
  for (const vec of vectors) {
    Buffer.from(vec.buffer, vec.byteOffset, rowBytes).copy(chunk, offset);
    offset += rowBytes;
    if (offset === chunk.byteLength) {
      out.write(Buffer.from(chunk));
      offset = 0;
    }
  }
  if (offset > 0) out.write(chunk.subarray(0, offset));

  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on('error', reject);
  });

  const size = fs.statSync(args.output).size;
  console.log(`Wrote ${args.output} (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log('Set EMBEDDING_PROVIDER=vectors (or leave it on auto) and restart the server.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
