/**
 * The moderator statistics payload and the match replay paths: the two things
 * the other suites cannot reach, because one needs a role and the other needs a
 * finished match.
 *
 * Promotes a throwaway guest to moderator directly in the database, which is
 * the only way to exercise the gate without a real Discord sign-in.
 *
 * Needs a server on :3001.  node scripts/smoke-stats.mjs
 */
import { io } from 'socket.io-client';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.MIVIMOOSE_URL ?? 'http://localhost:3001';
const prisma = new PrismaClient();
const results = [];

function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function guest(name) {
  const res = await fetch(`${BASE}/api/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

function rest(token) {
  return async (path) => {
    const res = await fetch(`${BASE}/api${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { status: res.status, ok: res.ok, body: await res.json().catch(() => null) };
  };
}

function connect(token) {
  const socket = io(BASE, { transports: ['websocket'], auth: { token } });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 8000);
  });
}

const ask = (socket, event, payload) =>
  new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve);
    else socket.emit(event, payload, resolve);
  });

async function main() {
  /* ------------------------------------------------- the moderator gate */
  const mod = await guest('Warden');
  const plain = await guest('Passerby');

  const before = await rest(mod.token)('/stats?range=day');
  check('a plain account is refused', before.status === 403, `status=${before.status}`);

  await prisma.user.update({ where: { id: mod.user.id }, data: { role: 'moderator' } });

  const after = await rest(mod.token)('/stats?range=day');
  check('a moderator gets through', after.ok, `status=${after.status}`);
  check('and a plain account still cannot', (await rest(plain.token)('/stats?range=day')).status === 403);

  const stats = after.body ?? {};
  check('payload carries a series', Array.isArray(stats.points), `points=${stats.points?.length}`);
  check('payload carries a peak', typeof stats.peak?.online === 'number', JSON.stringify(stats.peak));
  check(
    'payload carries live counts',
    typeof stats.current?.online === 'number' && typeof stats.current?.rooms === 'number',
    JSON.stringify(stats.current),
  );
  check(
    'payload carries lifetime totals',
    typeof stats.totals?.players === 'number' && typeof stats.totals?.matches === 'number',
    JSON.stringify(stats.totals),
  );
  for (const range of ['day', 'week', 'month']) {
    const r = await rest(mod.token)(`/stats?range=${range}`);
    check(`${range} range answers`, r.ok && r.body.range === range);
  }

  /* ------------------------------------------------------ replay paths */
  const a = await guest('Rowan');
  const b = await guest('Sorrel');
  const aSock = await connect(a.token);
  const bSock = await connect(b.token);

  const created = await ask(aSock, 'room:create', {
    mode: 'classic',
    customWords: ['harbor'],
    rounds: 1,
    roundSeconds: 60,
  });
  await ask(bSock, 'room:join', { code: created.data.code });

  const finished = new Promise((resolve) => aSock.once('match:end', resolve));
  await ask(aSock, 'room:start');
  await wait(4500);

  // A deliberate route, so the recorded path has a shape worth checking.
  for (const w of ['music', 'anchor', 'sailor']) {
    await ask(aSock, 'game:guess', { word: w });
    await wait(200);
  }
  await ask(bSock, 'game:guess', { word: 'anchor' }); // a steal
  await wait(200);
  await ask(aSock, 'game:guess', { word: 'harbor' }); // the find
  const result = await Promise.race([finished, wait(20000).then(() => null)]);
  check('match finished', Boolean(result), result?.matchId ?? 'no match:end');

  await wait(900); // persistence writes after the result is emitted

  const replay = await rest(a.token)(`/match/${result.matchId}/replay`);
  check('replay loads', replay.ok, `status=${replay.status}`);

  const paths = replay.body?.paths ?? [];
  const mine = paths.find((p) => p.user.displayName === a.user.displayName);
  check('every player has a path', paths.length === 2, `paths=${paths.length}`);
  check('the path records every guess', mine?.guesses.length === 4, `guesses=${mine?.guesses.length}`);
  check(
    'the path is in PLAY order, not rank order',
    mine?.guesses.map((g) => g.word).join(',') === 'music,anchor,sailor,harbor',
    mine?.guesses.map((g) => g.word).join(','),
  );
  check('the path knows it ended in a find', mine?.found === true && mine?.bestRank === 1);
  check('the round secret is on the path', mine?.secret === 'harbor', mine?.secret);

  const theirs = paths.find((p) => p.user.displayName === b.user.displayName);
  check(
    'a stolen word is flagged on the path',
    theirs?.guesses.some((g) => g.word === 'anchor' && g.stolen === true),
    JSON.stringify(theirs?.guesses),
  );

  aSock.close();
  bSock.close();
  await prisma.$disconnect();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (err) => {
  console.error('TEST ERROR', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
