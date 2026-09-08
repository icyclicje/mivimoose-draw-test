import { io } from 'socket.io-client';

const BASE = process.env.MIVIMOOSE_URL ?? 'http://localhost:3001';

async function login(name) {
  const res = await fetch(`${BASE}/api/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`login failed for ${name}: ${res.status}`);
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(socket, event, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), timeout);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const results = [];
function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  const alice = await login('Alice');
  const bob = await login('Bob');

  const aSock = await connect(alice.token, 'alice');
  const bSock = await connect(bob.token, 'bob');
  console.log('both sockets connected\n');

  // Attach before any room traffic. The server pushes room:state from inside
  // the create/join handlers, so those frames are already in flight by the time
  // an ack callback resolves — subscribing afterwards is a race.
  let aState = null;
  aSock.on('room:state', (s) => (aState = s));
  let bState = null;
  bSock.on('room:state', (s) => (bState = s));

  // Deterministic single-round duel on a known word.
  const created = await ask(aSock, 'room:create', {
    mode: 'duel',
    customWords: ['ocean'],
    rounds: 1,
    roundSeconds: 60,
    visibility: 'full',
    showStolenWords: true,
  });
  check('room created', created.ok, created.error ?? created.data?.code);
  const code = created.data.code;

  const joined = await ask(bSock, 'room:join', { code });
  check('second player joined', joined.ok, joined.error ?? '');

  await wait(300);
  check('lobby holds two players', aState?.players.length === 2, `players=${aState?.players.length}`);
  check('mode locked to duel', aState?.settings.mode === 'duel');
  check('custom word list accepted', aState?.settings.customWords?.length === 1, JSON.stringify(aState?.settings.customWords));

  const roundStart = waitFor(aSock, 'round:start');
  const started = await ask(aSock, 'room:start');
  check('host started the match', started.ok, started.error ?? '');
  await roundStart;
  console.log('\nround started\n');

  // Alice plays a mid-distance word.
  const g1 = await ask(aSock, 'game:guess', { word: 'sailor' });
  check('alice guess ranked', g1.ok && typeof g1.data?.rank === 'number', `rank=${g1.data?.rank} band=${g1.data?.band}`);
  check('alice guess not flagged as stolen', g1.ok && g1.data?.stolenFrom === null);

  // Bob plays the same word -> must be tagged as already claimed by Alice.
  const g2 = await ask(bSock, 'game:guess', { word: 'sailor' });
  check('bob got the same rank', g2.ok && g2.data?.rank === g1.data?.rank, `rank=${g2.data?.rank}`);
  check(
    'STEAL: bob sees "guessed by Alice"',
    g2.data?.stolenFrom?.displayName === 'Alice',
    JSON.stringify(g2.data?.stolenFrom),
  );

  // Duplicate by the same player is rejected.
  const g3 = await ask(aSock, 'game:guess', { word: 'sailor' });
  // Replaying your own word is not an error — the board re-pins the original
  // row and marks it, so a forgetful player is not punished with a red banner.
  check(
    'repeat by same player re-surfaces the original row',
    g3.ok && g3.data?.repeat === true && g3.data?.id === g1.data?.id,
    `repeat=${g3.data?.repeat} sameRow=${g3.data?.id === g1.data?.id}`,
  );

  // Unknown word rejected.
  const g4 = await ask(aSock, 'game:guess', { word: 'zzzzqqq' });
  check('unknown word rejected', !g4.ok && g4.code === 'unknown-word', g4.error ?? '');

  // Case and inflection handling. With the full GloVe index `waves` has its own
  // vector and its own rank, so it resolves to itself; the base-form fallback in
  // resolveWord only fires for input the vocabulary does not carry, which is the
  // common case on the smaller bundled topic model. Either outcome is correct —
  // what must hold is that the input is normalised and ranked rather than
  // rejected.
  const g5 = await ask(aSock, 'game:guess', { word: 'WAVES' });
  check(
    'uppercase inflection is normalised and ranked',
    g5.ok && /^waves?$/.test(g5.data?.word ?? '') && Number.isInteger(g5.data?.rank),
    `word=${g5.data?.word} rank=${g5.data?.rank}`,
  );

  // Hint should be closer than the current best.
  const bestBefore = Math.min(...[g1, g5].filter((g) => g.ok).map((g) => g.data.rank));
  const h = await ask(aSock, 'game:hint');
  check('hint returned a closer word', h.ok && h.data.rank < bestBefore, `hint=${h.data?.word} rank=${h.data?.rank} (best was ${bestBefore})`);

  // Chat must not leak the answer.
  bSock.emit('chat:send', { text: 'the answer is ocean' });
  await wait(300);
  const leaked = (bState?.feed ?? []).some((f) => f.kind === 'chat' && /ocean/i.test(f.text));
  check('chat filters the secret word', !leaked);

  const matchEnd = waitFor(bSock, 'match:end', 20000);

  // Alice finds it.
  const win = await ask(aSock, 'game:guess', { word: 'ocean' });
  check('finding the word returns rank 1', win.ok && win.data?.rank === 1, `rank=${win.data?.rank} band=${win.data?.band}`);

  const result = await matchEnd;
  console.log('\nmatch ended\n');
  check('alice placed first', result.entries[0]?.displayName === 'Alice', JSON.stringify(result.entries.map((e) => `${e.displayName}:${e.placement}:${e.score}`)));
  check('ranked duel moved elo', result.entries.every((e) => e.ratingAfter !== null), JSON.stringify(result.entries.map((e) => `${e.displayName} ${e.ratingBefore}->${e.ratingAfter}`)));
  check('xp awarded', result.entries.every((e) => e.xpGained > 0), JSON.stringify(result.entries.map((e) => e.xpGained)));
  check('round recap carries the secret', result.rounds[0]?.secret === 'ocean', result.rounds[0]?.secret);
  check('neighbours revealed', (result.rounds[0]?.neighbours?.length ?? 0) > 3, result.rounds[0]?.neighbours?.slice(0, 5).map((n) => n.word).join(' '));

  aSock.close();
  bSock.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('TEST ERROR', err);
  process.exit(1);
});
