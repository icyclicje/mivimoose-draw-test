/**
 * Exercises the modes with bespoke round logic, which the duel and lobby smoke
 * tests never touch:
 *
 *   elimination  — the coldest player is knocked out each round and the match
 *                  ends early once one survivor is left
 *   suddenDeath  — turn order is enforced and a guess that fails to beat the
 *                  board costs a strike
 *   coop         — one shared guess budget, one shared board
 *
 *   node scripts/smoke-modes.mjs
 */

import { io } from 'socket.io-client';

const BASE = process.env.MIVIMOOSE_URL ?? 'http://localhost:3001';

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
  return res.json();
}

async function seat(name) {
  const account = await login(name);
  const socket = await new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], auth: { token: account.token } });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('connect timeout')), 8000);
  });
  const player = { name, account, socket, state: null };
  socket.on('room:state', (s) => (player.state = s));
  return player;
}

async function openRoom(host, guests, settings) {
  const created = await ask(host.socket, 'room:create', settings);
  if (!created.ok) throw new Error(`create failed: ${created.error}`);
  for (const guest of guests) {
    const joined = await ask(guest.socket, 'room:join', { code: created.data.code });
    if (!joined.ok) throw new Error(`${guest.name} join failed: ${joined.error}`);
  }
  await wait(300);
  return created.data.code;
}

/* ------------------------------------------------------------------ */

async function testElimination(players) {
  console.log('\n=== Elimination ===');
  const [host, ...guests] = players.slice(0, 4);

  await openRoom(host, guests, {
    mode: 'elimination',
    roundSeconds: 6,
    customWords: ['ocean', 'guitar', 'money', 'forest', 'winter'],
    visibility: 'best',
  });

  const ended = new Promise((r) => host.socket.once('match:end', r));
  const roundEnds = [];
  host.socket.on('round:end', (summary) => roundEnds.push(summary));

  const started = await ask(host.socket, 'room:start');
  check('elimination started', started.ok, started.error ?? '');

  // Everyone guesses at a deliberately different distance each round, so the
  // ordering is decided by rank rather than by a coin flip.
  const LADDER = [
    ['sea', 'wave', 'sailor', 'piano'],
    ['piano', 'violin', 'drum', 'lettuce'],
    ['cash', 'coin', 'wealth', 'shark'],
    ['tree', 'leaf', 'branch', 'coffee'],
  ];

  for (let round = 0; round < 4; round += 1) {
    await new Promise((r) => host.socket.once('round:start', r)).catch(() => undefined);
    await wait(250);
    const alive = (host.state?.players ?? []).filter((p) => p.status !== 'eliminated');
    await Promise.all(
      alive.map((seatState, i) => {
        const player = players.find((x) => x.account.user.id === seatState.user.id);
        if (!player) return null;
        return ask(player.socket, 'game:guess', { word: LADDER[round % LADDER.length][i % 4] });
      }),
    );
    if (host.state?.phase === 'matchEnd') break;
    await wait(6500);
    if (roundEnds.length >= 3) break;
  }

  const result = await Promise.race([ended, wait(30000).then(() => null)]);
  check('elimination produced a result', Boolean(result));
  if (result) {
    check(
      'somebody was eliminated each round',
      roundEnds.every((r) => r.eliminated.length === 1),
      roundEnds.map((r) => `r${r.round}:${r.eliminated.length}`).join(' '),
    );
    check(
      'match ended once one survivor remained',
      roundEnds.length <= 3,
      `${roundEnds.length} rounds for 4 players`,
    );
    check('winner placed first', result.entries[0]?.placement === 1, result.entries[0]?.displayName);
  }

  for (const p of players.slice(0, 4)) {
    host.socket.removeAllListeners('round:end');
    await ask(p.socket, 'room:leave');
  }
}

async function testSuddenDeath(players) {
  console.log('\n=== Sudden Death ===');
  const [host, guest] = players.slice(0, 2);

  await openRoom(host, [guest], {
    mode: 'suddenDeath',
    roundSeconds: 25,
    strikes: 3,
    customWords: ['ocean'],
    rounds: 1,
  });

  const roundStarted = new Promise((r) => host.socket.once('round:start', r));
  await ask(host.socket, 'room:start');
  await roundStarted;
  await wait(300);

  const active = host.state?.activePlayerId;
  check('a turn is assigned', Boolean(active), active ?? 'none');

  const onTurn = [host, guest].find((p) => p.account.user.id === active);
  const offTurn = [host, guest].find((p) => p.account.user.id !== active);

  const early = await ask(offTurn.socket, 'game:guess', { word: 'wave' });
  check('off-turn guess refused', !early.ok && early.code === 'not-your-turn', early.error ?? '');

  const first = await ask(onTurn.socket, 'game:guess', { word: 'sea' });
  check('on-turn guess accepted', first.ok, `rank=${first.data?.rank}`);
  await wait(200);
  check('turn passed to the opponent', host.state?.activePlayerId === offTurn.account.user.id);

  // A guess further out than the board's best must cost a strike.
  const weak = await ask(offTurn.socket, 'game:guess', { word: 'piano' });
  check('weak guess accepted but punished', weak.ok, `rank=${weak.data?.rank}`);
  await wait(250);
  const striker = host.state?.players.find((p) => p.user.id === offTurn.account.user.id);
  check('strike recorded for failing to beat the board', (striker?.strikes ?? 0) >= 1, `strikes=${striker?.strikes}`);

  for (const p of [host, guest]) await ask(p.socket, 'room:leave');
}

async function testCoop(players) {
  console.log('\n=== Co-op ===');
  const [host, ...guests] = players.slice(0, 3);

  await openRoom(host, guests, {
    mode: 'coop',
    roundSeconds: 30,
    teamGuessBudget: 6,
    customWords: ['ocean'],
    rounds: 1,
  });

  const roundStarted = new Promise((r) => host.socket.once('round:start', r));
  await ask(host.socket, 'room:start');
  await roundStarted;
  await wait(300);

  check('team budget is published', host.state?.teamGuessesLeft === 6, `left=${host.state?.teamGuessesLeft}`);

  await ask(host.socket, 'game:guess', { word: 'wave' });
  await wait(200);
  check('a guess spends from the shared budget', host.state?.teamGuessesLeft === 5, `left=${host.state?.teamGuessesLeft}`);

  await ask(guests[0].socket, 'game:guess', { word: 'sailor' });
  await wait(200);
  const board = (host.state?.players ?? []).flatMap((p) => p.guesses ?? []);
  check('the whole team sees every guess', board.length === 2, `board=${board.map((g) => g.word).join(',')}`);

  for (const p of players.slice(0, 3)) await ask(p.socket, 'room:leave');
}

/* ------------------------------------------------------------------ */

async function main() {
  const players = [];
  for (const name of ['M-One', 'M-Two', 'M-Three', 'M-Four']) players.push(await seat(name));
  console.log(`${players.length} sockets connected`);

  await testElimination(players);
  await testSuddenDeath(players);
  await testCoop(players);

  for (const p of players) p.socket.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('TEST ERROR', err);
  process.exit(1);
});
