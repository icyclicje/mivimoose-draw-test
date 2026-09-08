/**
 * Covers the behaviour the duel smoke test does not: guest accounts, quick-match
 * lobbies that start themselves, replayed guesses, and the daily share string.
 *
 * Needs a server on :3001.  node scripts/smoke-features.mjs
 */
import { io } from 'socket.io-client';
import { buildDailyShare } from '../shared/dist/index.js';

const BASE = 'http://localhost:3001';

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function guest(name) {
  const res = await fetch(`${BASE}/api/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`guest login failed: ${res.status}`);
  return res.json();
}

function connect(token, label) {
  const socket = io(BASE, { transports: ['websocket'], auth: { token } });
  socket.on('connect_error', (e) => console.log(`[${label}] connect_error`, e.message));
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    setTimeout(() => reject(new Error(`${label} could not connect`)), 8000);
  });
}

const ask = (socket, event, payload) =>
  new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve);
    else socket.emit(event, payload, resolve);
  });

async function main() {
  /* ---------------------------------------------------- guest accounts */
  const a = await guest('Wanderer');
  const b = await guest('Wanderer'); // same requested name, on purpose
  check('guest sign-in issues a token', Boolean(a.token && a.user?.id));
  check(
    'two guests are genuinely two accounts',
    a.user.id !== b.user.id,
    `${a.user.displayName} vs ${b.user.displayName}`,
  );

  const aSock = await connect(a.token, 'a');
  const bSock = await connect(b.token, 'b');

  let aState = null;
  aSock.on('room:state', (s) => (aState = s));
  let bState = null;
  bSock.on('room:state', (s) => (bState = s));

  /* ------------------------------------------------------- quick match */
  const q1 = await ask(aSock, 'room:quickplay', { mode: 'classic' });
  check('quick match placed the first player', q1.ok, q1.error ?? q1.data?.code);
  await wait(250);

  check('quick match is a managed lobby', aState?.autoStart === true);
  check(
    'quick match opens all ten seats',
    aState?.settings.maxPlayers === 10,
    `maxPlayers=${aState?.settings.maxPlayers}`,
  );
  check(
    'quick match does not count down with one player',
    aState?.deadline === null,
    `deadline=${aState?.deadline}`,
  );

  const locked = await ask(aSock, 'room:settings', { roundSeconds: 300 });
  check('quick match settings are locked', !locked.ok && locked.code === 'locked', locked.error ?? '');

  const q2 = await ask(bSock, 'room:quickplay', { mode: 'classic' });
  check('quick match pooled both players into one lobby', q2.data?.code === q1.data?.code,
    `${q1.data?.code} vs ${q2.data?.code}`);
  await wait(300);

  check('two players fills the lobby', aState?.players.length === 2, `players=${aState?.players.length}`);
  check(
    'reaching two players starts the countdown',
    typeof aState?.deadline === 'number' && aState.deadline > Date.now(),
    aState?.deadline ? `${Math.round((aState.deadline - Date.now()) / 1000)}s to go` : 'no deadline',
  );
  check('answers default to everyday words', aState?.settings.difficulty === 'easy',
    aState?.settings.difficulty);

  /* -------------------------------------------------- replayed guesses */
  // A custom room lets us pin the answer and drive a round deterministically.
  const custom = await ask(aSock, 'room:create', {
    mode: 'classic',
    customWords: ['harbor'],
    rounds: 1,
    roundSeconds: 60,
  });
  check('custom room created', custom.ok, custom.error ?? '');
  await ask(bSock, 'room:join', { code: custom.data.code });
  await ask(aSock, 'room:start');
  await wait(4200);

  const first = await ask(aSock, 'game:guess', { word: 'anchor' });
  check('first guess ranked', first.ok && typeof first.data?.rank === 'number', `rank=${first.data?.rank}`);

  const again = await ask(aSock, 'game:guess', { word: 'anchor' });
  check('replaying your own word is not an error', again.ok, again.error ?? '');
  check('replay comes back flagged as a repeat', again.data?.repeat === true);
  check(
    'replay returns the same row, not a new one',
    again.data?.id === first.data?.id && again.data?.rank === first.data?.rank,
  );

  const steal = await ask(bSock, 'game:guess', { word: 'anchor' });
  check(
    'another player replaying it is a steal, not a repeat',
    steal.data?.repeat === false && steal.data?.stolenFrom?.displayName === a.user.displayName,
    JSON.stringify(steal.data?.stolenFrom),
  );

  aSock.close();
  bSock.close();

  /* --------------------------------------------------------- the daily */
  const dailyRes = await fetch(`${BASE}/api/daily`, {
    headers: { Authorization: `Bearer ${a.token}` },
  });
  const daily = await dailyRes.json();
  check('daily challenge loads', dailyRes.ok && typeof daily.date === 'string', daily.date);

  const share = buildDailyShare({
    date: '2026-09-07',
    solved: true,
    standing: 4,
    guesses: [
      { rank: 1 }, { rank: 12 }, { rank: 240 },
      { rank: 900 }, { rank: 1400 },
      ...Array.from({ length: 14 }, () => ({ rank: 40000 })),
    ],
    url: 'http://localhost:3000',
  });
  check('share string names the day and the count', share.includes('2026-09-07') && share.includes('19 guesses'));
  check('share string uses heat blocks', share.includes('🟩') && share.includes('🟧') && share.includes('🟥'));
  check('share string caps long runs', share.includes('+4'), share.split('\n').find((l) => l.includes('+')) ?? '');
  check('share string leaks no answer', !/harbor/i.test(share));
  console.log('\n--- share preview ---\n' + share + '\n---------------------\n');

  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('TEST ERROR', err);
  process.exit(1);
});
