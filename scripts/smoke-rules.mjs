/**
 * The rule changes: closing claimed words, revealing the answer's length,
 * thin-word rejection, form normalisation, the one-round duel, and the daily
 * co-op room.
 *
 * Needs a server on :3001.  node scripts/smoke-rules.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.MIVIMOOSE_URL ?? 'http://localhost:3001';
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

/** Runs a one-round room on a known word and hands back live sockets + state. */
async function startRoom(a, b, settings) {
  const created = await ask(a.socket, 'room:create', {
    mode: 'classic',
    customWords: ['harbor'],
    rounds: 1,
    roundSeconds: 120,
    endOnFirstFind: false,
    ...settings,
  });
  await ask(b.socket, 'room:join', { code: created.data.code });
  await ask(a.socket, 'room:start');
  await wait(4600);
  return created.data.code;
}

async function main() {
  const a = await guest('Alder');
  const b = await guest('Birch');
  a.socket = await connect(a.token);
  b.socket = await connect(b.token);
  a.state = null;
  b.state = null;
  a.socket.on('room:state', (s) => (a.state = s));
  b.socket.on('room:state', (s) => (b.state = s));

  /* ------------------------------------------- claimed words are closed */
  await startRoom(a, b, { lockClaimedWords: true, showStolenWords: true });

  const first = await ask(a.socket, 'game:guess', { word: 'anchor' });
  check('first player takes the word', first.ok, `rank=${first.data?.rank}`);

  const blocked = await ask(b.socket, 'game:guess', { word: 'anchor' });
  check('a claimed word is refused', !blocked.ok && blocked.code === 'already-guessed', blocked.error ?? '');
  check('the refusal names who took it', /Alder/.test(blocked.error ?? ''), blocked.error ?? '');

  await wait(200);
  const bPlayer = (b.state?.players ?? []).find((p) => p.user.displayName === 'Birch');
  check('a refused word costs no guess', bPlayer?.guessCount === 0, `guessCount=${bPlayer?.guessCount}`);

  // Your own replay is still a repeat, not a block.
  const mine = await ask(a.socket, 'game:guess', { word: 'anchor' });
  check('your own replay is still allowed', mine.ok && mine.data?.repeat === true);

  await ask(a.socket, 'room:leave');
  await ask(b.socket, 'room:leave');
  await wait(300);

  /* ------------------------------------------------ unlocked still steals */
  await startRoom(a, b, { lockClaimedWords: false, showStolenWords: true });
  await ask(a.socket, 'game:guess', { word: 'anchor' });
  const stolen = await ask(b.socket, 'game:guess', { word: 'anchor' });
  check('with the lock off the word is playable', stolen.ok, stolen.error ?? '');
  check(
    'and the row is marked with who was first',
    stolen.data?.stolenFrom?.displayName === 'Alder',
    JSON.stringify(stolen.data?.stolenFrom),
  );

  /* ------------------------------------------------------- normalisation */
  // Anything the 200k list already holds, including British spellings like
  // "harbours", must be ranked exactly as typed. Rewriting those is the bug
  // that would break every word with more than one accepted spelling.
  for (const listed of ['harbours', 'leaves', 'colour', 'organise']) {
    const r = await ask(a.socket, 'game:guess', { word: listed });
    await wait(400);
    if (!r.ok) {
      // Not in the list on this build; the claim under test does not apply.
      check(`"${listed}" is unknown here, so nothing to rewrite`, r.code === 'unknown-word', r.error ?? '');
      continue;
    }
    check(
      `"${listed}" is ranked as typed, not rewritten`,
      r.data?.word === listed && r.data?.normalizedFrom === null,
      `word=${r.data?.word} from=${r.data?.normalizedFrom}`,
    );
  }

  // A form the list does NOT hold should fall back to its base and say so.
  let normalised = null;
  for (const form of ['harborings', 'anchorings', 'sailorings', 'reharbored']) {
    const r = await ask(a.socket, 'game:guess', { word: form });
    await wait(400);
    if (r.ok && r.data?.normalizedFrom) {
      normalised = { form, ...r.data };
      break;
    }
  }
  check(
    'an unlisted form falls back to its base and reports the original',
    normalised !== null && normalised.normalizedFrom === normalised.form && normalised.word !== normalised.form,
    normalised ? `${normalised.form} -> ${normalised.word}` : 'no candidate form fell back',
  );

  /* ---------------------------------------------------------- thin words */
  // Paced: the server rate-limits guesses at ~3/sec, and a burst reads as
  // "slow down" rather than as a verdict on the word.
  for (const word of ['very', 'important', 'different', 'basically']) {
    const r = await ask(a.socket, 'game:guess', { word });
    await wait(400);
    check(`"${word}" is refused as too common`, !r.ok && r.code === 'too-common', r.error ?? 'accepted');
  }
  // ...but real descriptors still play.
  for (const word of ['cold', 'heavy', 'sharp']) {
    const r = await ask(a.socket, 'game:guess', { word });
    await wait(400);
    check(`"${word}" is still guessable`, r.ok, r.error ?? '');
  }

  await ask(a.socket, 'room:leave');
  await ask(b.socket, 'room:leave');
  await wait(300);

  /* ------------------------------------------------------- word length */
  await startRoom(a, b, { showWordLength: true });
  await wait(300);
  check('the answer length is published', a.state?.secretLength === 'harbor'.length, `secretLength=${a.state?.secretLength}`);

  await ask(a.socket, 'room:leave');
  await ask(b.socket, 'room:leave');
  await wait(300);

  await startRoom(a, b, { showWordLength: false });
  await wait(300);
  check('and withheld when off', a.state?.secretLength === null, `secretLength=${a.state?.secretLength}`);

  await ask(a.socket, 'room:leave');
  await ask(b.socket, 'room:leave');
  await wait(300);

  /* -------------------------------------------------------------- duel */
  const duel = await ask(a.socket, 'room:create', { mode: 'duel' });
  check('duel room created', duel.ok, duel.error ?? '');
  await wait(300);
  check('duel is one round', a.state?.settings.rounds === 1, `rounds=${a.state?.settings.rounds}`);
  check('duel is three minutes', a.state?.settings.roundSeconds === 180, `seconds=${a.state?.settings.roundSeconds}`);
  check('duel closes claimed words', a.state?.settings.lockClaimedWords === true);
  await ask(a.socket, 'room:leave');
  await wait(300);

  /* -------------------------------------------------------- daily co-op */
  const coop = await ask(a.socket, 'room:dailyCoop');
  check('daily co-op room opens', coop.ok, coop.error ?? '');
  await wait(400);
  check('it is a co-op room', a.state?.mode === 'coop', a.state?.mode);
  check('it is private', a.state?.settings.private === true);
  check(
    'and the answer is not leaked through settings',
    a.state?.settings.customWords === null,
    JSON.stringify(a.state?.settings.customWords),
  );

  a.socket.close();
  b.socket.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error('TEST ERROR', err);
  process.exit(1);
});
