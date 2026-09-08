/**
 * One command to fetch every word-data file the game needs and build the
 * vector index:
 *
 *   npm run setup:words
 *
 * Downloads land in server/data/, which is gitignored — these files are large
 * and freely re-fetchable, so they are not checked in.
 *
 * What it pulls, and why each one is needed:
 *
 *   glove-200d.gz    GloVe 6B, 400k words x 200 dimensions, from the gensim-data
 *                    mirror (252MB, much smaller than Stanford's 822MB bundle).
 *                    This is the semantic model: the whole game is cosine
 *                    similarity in this space. Frequency-ordered, which is also
 *                    what the difficulty bands slice.
 *   en.dic           Hunspell English dictionary. Load-bearing: GloVe is
 *                    lowercased, so `rome` and `mohammed` look exactly like
 *                    common nouns. Hunspell still carries the case, so keeping
 *                    only its lowercase stems drops every proper noun at once.
 *   words_alpha.txt  A broad word list, kept as a fallback if en.dic is absent.
 *   firstnames.txt   A second guard against names slipping into answers.
 *
 * Then it runs build-index to turn the GloVe text into the compact binary the
 * server memory-maps at boot, and deletes the 660MB decompressed intermediate.
 *
 * Skips anything already present. Pass --force to redownload, --keep-raw to
 * leave the decompressed GloVe text on disk.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';

const DATA = path.resolve(process.cwd(), 'data');
const FORCE = process.argv.includes('--force');
const KEEP_RAW = process.argv.includes('--keep-raw');

const DOWNLOADS = [
  {
    name: 'glove-200d.gz',
    url: 'https://github.com/RaRe-Technologies/gensim-data/releases/download/glove-wiki-gigaword-200/glove-wiki-gigaword-200.gz',
    about: 'GloVe 6B 200d word vectors (252MB)',
  },
  {
    name: 'en.dic',
    url: 'https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/en/index.dic',
    about: 'Hunspell English dictionary — the proper-noun filter',
  },
  {
    name: 'words_alpha.txt',
    url: 'https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt',
    about: 'broad English word list (fallback dictionary)',
  },
  {
    name: 'firstnames.txt',
    url: 'https://raw.githubusercontent.com/dominictarr/random-name/master/first-names.txt',
    about: 'first names, as a second guard against proper nouns',
  },
];

function human(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
    : `${(bytes / 1024).toFixed(0)}KB`;
}

async function download(url: string, dest: string, about: string) {
  if (fs.existsSync(dest) && !FORCE) {
    console.log(`  have  ${path.basename(dest)}  (${human(fs.statSync(dest).size)})`);
    return;
  }
  console.log(`  get   ${path.basename(dest)}  — ${about}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${url} returned ${res.status}`);

  const tmp = `${dest}.part`;
  await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  console.log(`        done (${human(fs.statSync(dest).size)})`);
}

async function gunzip(src: string, dest: string) {
  if (fs.existsSync(dest) && !FORCE) {
    console.log(`  have  ${path.basename(dest)}`);
    return;
  }
  console.log(`  unzip ${path.basename(src)} -> ${path.basename(dest)}`);
  const tmp = `${dest}.part`;
  await pipeline(fs.createReadStream(src), zlib.createGunzip(), fs.createWriteStream(tmp));
  fs.renameSync(tmp, dest);
  console.log(`        done (${human(fs.statSync(dest).size)})`);
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  console.log('Fetching word data into server/data\n');

  for (const item of DOWNLOADS) {
    await download(item.url, path.join(DATA, item.name), item.about);
  }

  const raw = path.join(DATA, 'glove-200d.txt');
  const index = path.join(DATA, 'index.bin');

  if (fs.existsSync(index) && !FORCE) {
    console.log(`\n  have  index.bin (${human(fs.statSync(index).size)}) — nothing to build`);
  } else {
    console.log('');
    await gunzip(path.join(DATA, 'glove-200d.gz'), raw);

    console.log('\nBuilding the vector index (this takes a minute)\n');
    // Resolve through the package's `exports` map (via `createRequire`) rather
    // than a hardcoded node_modules path — npm workspaces hoist tsx to the
    // repo root, so it doesn't live under server/node_modules.
    const tsxCli = createRequire(import.meta.url).resolve('tsx/cli');
    const built = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=6144',
        tsxCli,
        path.resolve(process.cwd(), 'scripts', 'build-index.ts'),
        '--input',
        raw,
        '--output',
        index,
        '--limit',
        '200000',
      ],
      { stdio: 'inherit', cwd: process.cwd() },
    );
    if (built.status !== 0) {
      console.error('\nIndex build failed. You can retry it directly with:');
      console.error('  npm run build:index -- --input ./data/glove-200d.txt --limit 200000');
      process.exit(1);
    }
  }

  if (!KEEP_RAW && fs.existsSync(raw)) {
    const size = fs.statSync(raw).size;
    fs.unlinkSync(raw);
    console.log(`\n  clean removed the decompressed GloVe text (${human(size)}); the .gz is kept for rebuilds`);
  }

  console.log('\nReady. Start the server and it will pick the index up automatically.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
