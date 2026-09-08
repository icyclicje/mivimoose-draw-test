/**
 * Friends, invites, presence, ready-up, the restored steal marker, match
 * replay paths and the moderator gate on statistics.
 *
 * Needs a server on :3001.  node scripts/smoke-social.mjs
 */
import { io } from 'socket.io-client';

const BASE = process.env.MIVIMOOSE_URL ?? 'http://localhost:3001';
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
  if (!res.ok) throw new Error(`guest ${name}: ${res.status}`);
  return res.json();
}

function rest(token) {
  return async (path, init = {}) => {
    const res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, body };
  };
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
  const a = await guest('Alder');
  const b = await guest('Birch');
  const apiA = rest(a.token);
  const apiB = rest(b.token);

  /* ------------------------------------------------------------ friends */
  const req = await apiA(`/friends/${b.user.id}`, { method: 'POST' });
  check('friend request sent', req.ok && req.body.status === 'pending', JSON.stringify(req.body));

  const pendingB = await apiB('/friends');
  check(
    'the request shows as incoming for the other player',
    pendingB.body.incoming.length === 1 && pendingB.body.incoming[0].user.id === a.user.id,
    `incoming=${pendingB.body.incoming.length}`,
  );

  const dupe = await apiA(`/friends/${b.user.id}`, { method: 'POST' });
  check('a duplicate request is refused', dupe.status === 409, dupe.body?.error ?? '');

  const accept = await apiB(`/friends/${a.user.id}/respond`, {
    method: 'POST',
    body: JSON.stringify({ accept: true }),
  });
  check('request accepted', accept.ok && accept.body.status === 'accepted');

  const listA = await apiA('/friends');
  check('both sides now see a friend', listA.body.friends.length === 1, `friends=${listA.body.friends.length}`);
  check('self-add is refused', (await apiA(`/friends/${a.user.id}`, { method: 'POST' })).status === 409);

  /* ----------------------------------------------------------- presence */
  const aSock = await connect(a.token, 'a');
  const bSock = await connect(b.token, 'b');
  await wait(600);

  const presence = await apiA('/presence');
  check('presence counts connected players', presence.body.online >= 2, `online=${presence.body.online}`);

  const listOnline = await apiA('/friends');
  check(
    'a connected friend shows as online',
    listOnline.body.friends[0]?.online === true,
    JSON.stringify(listOnline.body.friends[0]?.activity),
  );

  /* ------------------------------------------------------------ invites */
  const created = await ask(aSock, 'room:create', {
    mode: 'classic',
    // One word, one round: the secret is then known, so "does the round end
    // on a find" is actually testable rather than a coin flip.
    customWords: ['harbor'],
    rounds: 1,
    roundSeconds: 90,
  });
  check('room created for the invite', created.ok, created.error ?? '');

  const invited = new Promise((resolve) => bSock.once('invite:received', resolve));
  const inviteAck = await ask(aSock, 'friend:invite', { friendId: b.user.id });
  check('invite accepted by the server', inviteAck.ok, inviteAck.error ?? '');

  const invite = await Promise.race([invited, wait(4000).then(() => null)]);
  check('the friend actually receives it', invite?.code === created.data.code, JSON.stringify(invite?.from?.displayName));

  const joined = await ask(bSock, 'invite:accept', { code: created.data.code });
  check('invite join works', joined.ok && joined.data.code === created.data.code);

  // A stranger cannot be invited.
  const c = await guest('Cedar');
  const cSock = await connect(c.token, 'c');
  const strangerInvite = await ask(aSock, 'friend:invite', { friendId: c.user.id });
  check('non-friends cannot be invited', !strangerInvite.ok, strangerInvite.error ?? '');
  cSock.close();

  /* -------------------------------------------------------- ready to go */
  let aState = null;
  aSock.on('room:state', (s) => (aState = s));
  await wait(400);

  aSock.emit('room:ready', true);
  await wait(400);
  check('one ready player does not start a host room', aState?.phase === 'lobby', aState?.phase);

  const started = new Promise((resolve) => aSock.once('round:start', resolve));
  bSock.emit('room:ready', true);
  await wait(600);
  check(
    'everyone ready starts the match without the host pressing start',
    aState?.phase === 'countdown' || aState?.phase === 'playing',
    aState?.phase,
  );
  await Promise.race([started, wait(6000)]);
  await wait(500);

  /* --------------------------------------------------------- the steal */
  const g1 = await ask(aSock, 'game:guess', { word: 'anchor' });
  check('guess ranked', g1.ok && typeof g1.data?.rank === 'number', `rank=${g1.data?.rank}`);
  check('your own guess is not marked stolen', g1.data?.stolenFrom === null);

  const g2 = await ask(bSock, 'game:guess', { word: 'anchor' });
  check('a claimed word is still playable', g2.ok, g2.error ?? '');
  check(
    'STEAL: it names who got there first',
    g2.data?.stolenFrom?.displayName === a.user.displayName,
    JSON.stringify(g2.data?.stolenFrom),
  );
  check('and it still returns the rank', g2.data?.rank === g1.data?.rank, `rank=${g2.data?.rank}`);

  const g3 = await ask(aSock, 'game:guess', { word: 'anchor' });
  check('your own replay is a repeat, not a steal', g3.data?.repeat === true && g3.data?.stolenFrom === null);

  /* ------------------------------------------------- ends on first find */
  const ended = new Promise((resolve) => aSock.once('round:end', resolve));
  await ask(aSock, 'game:guess', { word: 'harbor' });
  const summary = await Promise.race([ended, wait(5000).then(() => null)]);
  check('a public round ends the moment someone finds it', Boolean(summary), summary?.secret ?? 'no round:end');

  /* -------------------------------------------------------- match stats */
  const statsA = await apiA('/stats?range=day');
  check('statistics are moderators only', statsA.status === 403, `status=${statsA.status}`);

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
