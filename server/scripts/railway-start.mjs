// Railway's start command. Plain JS (no tsx) so it runs against the compiled
// build with nothing extra required.
//
// What it does, in order:
//   1. If a Railway Volume is attached, restore data/index.bin from it so a
//      redeploy doesn't pay for the ~250MB GloVe download + index build again.
//   2. Run `npm run setup:words` — skips anything already on disk, so on a
//      warm volume this only re-fetches the small dictionary files.
//   3. Copy a freshly built index.bin back to the volume so the next deploy
//      is warm too.
//   4. `prisma db push` so a fresh (or newly attached) database gets its
//      schema without a manual step.
//   5. Start the server.
//
// Set EMBEDDING_PROVIDER=topic to skip the word-data dance entirely and boot
// on the bundled 1,808-word topic model instead.

import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..'); // server/

function run(cmd, args) {
  console.log(`[railway-start] $ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error(`[railway-start] "${cmd} ${args.join(' ')}" exited with ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

const localIndex = path.join(root, 'data', 'index.bin');
fs.mkdirSync(path.dirname(localIndex), { recursive: true });

const volumeDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || null;
const persistedIndex = volumeDir ? path.join(volumeDir, 'vectors', 'index.bin') : null;

if (persistedIndex) {
  fs.mkdirSync(path.dirname(persistedIndex), { recursive: true });
  if (fs.existsSync(persistedIndex) && !fs.existsSync(localIndex)) {
    console.log('[railway-start] restoring vector index from the volume');
    fs.copyFileSync(persistedIndex, localIndex);
  }
} else {
  console.log('[railway-start] no RAILWAY_VOLUME_MOUNT_PATH set — the vector index will not survive a redeploy');
}

if (process.env.EMBEDDING_PROVIDER !== 'topic') {
  console.log('[railway-start] ensuring word data is present (first boot can take a few minutes)');
  run('npm', ['run', 'setup:words']);

  if (persistedIndex && fs.existsSync(localIndex)) {
    console.log('[railway-start] persisting vector index to the volume');
    fs.copyFileSync(localIndex, persistedIndex);
  }
} else {
  console.log('[railway-start] EMBEDDING_PROVIDER=topic — skipping the vector download');
}

// No --accept-data-loss here on purpose: a destructive schema change should
// fail the deploy loudly rather than silently drop a column of real data. Run
// it by hand (`railway run npm run db:push -- --accept-data-loss`) when you
// actually mean it.
console.log('[railway-start] syncing database schema');
run('npx', ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate']);

console.log('[railway-start] starting server');
const child = spawn('node', ['dist/index.js'], { stdio: 'inherit', cwd: root });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
