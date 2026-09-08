/**
 * Ten-player smoke test.
 *
 * Fills a Classic Race room to its cap, confirms the eleventh arrival is pushed
 * to spectators, plays one timed round with everybody guessing, and checks the
 * final standings come back ordered and complete.
 *
 *   node scripts/smoke-lobby.mjs
 */

import { io } from 'socket.io-client';

const BASE = process.env.MIVIMOOSE_URL ?? 'http://localhost:3001';
const NAMES = ['Ada', 'Bo', 'Cyd', 'Dot', 'Eze', 'Fen', 'Gus', 'Hal', 'Ivy', 'Jem', 'Kit'];

const results = [];
function check(label, ok, detail = '') {
  results.push({ label, ok: Boolean(ok) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ask = (socket, event, payload) =>
  new Promise((resolve) => {
    if (payload === undefined) socket.emit(event, resolve);
    else socket.emit(event, payload, resolve);
  });

async function login(name) {
  const res = await fetch(`${BASE}/api/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`login failed for ${name}`);
  return res.json();
}

function connect(token) {
  const socket = io(BASE, { transports: ['websocket'], auth: { token } });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 8000);
  });
}

async function main() {
  const players = [];
  for (const name of NAMES) {
    const account = await login(`T-${name}`);
    const socket = await connect(account.token);
    const player = { name, account, socket, state: null };
    socket.on('room:state', (s) => (player.state = s));
    players.push(player);
  }
  console.log(`${players.length} sockets connected\n`);

  const [host, ...rest] = players;

  const created = await ask(host.socket, 'room:create', {
    mode: 'classic',
    maxPlayers: 10,
    rounds: 1,
    roundSeconds: 10,
    customWords: ['ocean'],
    visibility: 'best',
    endOnFirstFind: false,
  });
  check('room created', created.ok, created.data?.code);
  const code = created.data.code;

  for (const player of rest) {
    const res = await ask(player.socket, 'room:join', { code });
    if (!res.ok) console.log(`  ${player.name} join failed: ${res.error}`);
  }
  await wait(500);

  const lobby = host.state;
  check('lobby capped at ten players', lobby?.players.length === 10, `players=${lobby?.players.length}`);
  check('eleventh arrival became a spectator', lobby?.spectators.length === 1, `spectators=${lobby?.spectators.length}`);

  const ended = new Promise((resolve) => host.socket.once('match:end', resolve));
  const roundStarted = new Promise((resolve) => host.socket.once('round:start', resolve));

  const started = await ask(host.socket, 'room:start');
  check('match started', started.ok, started.error ?? '');
  await roundStarted;
  console.log('\nround live — everybody guessing\n');

  // A spread of words so the standings are not all ties.
  const WORDS = ['wave', 'sailor', 'guitar', 'money', 'island', 'shark', 'coffee', 'harbor', 'piano', 'reef'];
  const seats = lobby.players.map((p) => players.find((x) => x.account.user.id === p.user.id)).filter(Boolean);

  await Promise.all(
    seats.map(async (player, i) => {
      const res = await ask(player.socket, 'game:guess', { word: WORDS[i % WORDS.length] });
      if (!res.ok) console.log(`  ${player.name} guess rejected: ${res.error}`);
    }),
  );

  const anyRanked = seats.length > 0 && host.state?.players.some((p) => p.bestRank !== null);
  check('guesses registered on the board', anyRanked);

  // A word another player already burned must come back tagged.
  const stealer = seats[1];
  const steal = await ask(stealer.socket, 'game:guess', { word: WORDS[0] });
  check(
    'STEAL: duplicate word is attributed to the first player',
    steal.ok && steal.data?.stolenFrom?.displayName === `T-${seats[0].name}`,
    JSON.stringify(steal.data?.stolenFrom),
  );

  console.log('\nwaiting for the clock to run out…\n');
  const result = await ended;

  check('every seat is in the final standings', result.entries.length === 10, `entries=${result.entries.length}`);
  check(
    'placements are 1..10 with no gaps',
    result.entries.every((e, i) => e.placement === i + 1),
    result.entries.map((e) => `${e.displayName}:${e.placement}`).join(' '),
  );
  check(
    'scores are ordered high to low',
    result.entries.every((e, i, arr) => i === 0 || arr[i - 1].score >= e.score),
    result.entries.map((e) => e.score).join(','),
  );
  check('unranked classic left elo alone', result.entries.every((e) => e.ratingAfter === null));
  check('everyone earned xp', result.entries.every((e) => e.xpGained > 0));

  for (const player of players) player.socket.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('TEST ERROR', err);
  process.exit(1);
});
