import type {
  FriendList,
  FriendSummary,
  GuessPath,
  MatchReplay,
  PublicUser,
  ServerStats,
  StatsPoint,
  StatsRange,
} from '@mivimoose/shared';
import { prisma, toPublicUser } from './db.js';
import { log } from './log.js';

/* ------------------------------------------------------------------ *
 * Presence
 *
 * Who is connected right now, kept in memory. The socket layer owns the
 * numbers; everything else reads them through here so there is one source.
 * ------------------------------------------------------------------ */

export interface PresenceEntry {
  user: PublicUser;
  roomCode: string | null;
  activity: string | null;
}

const presence = new Map<string, PresenceEntry>();

export function setPresence(userId: string, entry: PresenceEntry): void {
  presence.set(userId, entry);
}

export function clearPresence(userId: string): void {
  presence.delete(userId);
}

export function getPresence(userId: string): PresenceEntry | undefined {
  return presence.get(userId);
}

export function onlineCount(): number {
  return presence.size;
}

export function onlineUserIds(): string[] {
  return [...presence.keys()];
}

/* ------------------------------------------------------------------ *
 * Friends
 * ------------------------------------------------------------------ */

function summarise(user: PublicUser, state: FriendSummary['state'], since: number): FriendSummary {
  const live = presence.get(user.id);
  return {
    user,
    state,
    online: Boolean(live),
    roomCode: live?.roomCode ?? null,
    activity: live?.activity ?? null,
    since,
  };
}

export async function friendListFor(userId: string): Promise<FriendList> {
  const rows = await prisma.friendship.findMany({
    where: {
      OR: [{ requesterId: userId }, { addresseeId: userId }],
      status: { in: ['pending', 'accepted'] },
    },
    include: { requester: true, addressee: true },
    orderBy: { createdAt: 'desc' },
  });

  const out: FriendList = { friends: [], incoming: [], outgoing: [] };

  for (const row of rows) {
    const iAsked = row.requesterId === userId;
    const other = iAsked ? row.addressee : row.requester;
    const summary = summarise(
      toPublicUser(other),
      row.status === 'accepted' ? 'friend' : iAsked ? 'outgoing' : 'incoming',
      (row.respondedAt ?? row.createdAt).getTime(),
    );
    if (row.status === 'accepted') out.friends.push(summary);
    else if (iAsked) out.outgoing.push(summary);
    else out.incoming.push(summary);
  }

  // Friends who are online sort first — the list exists to find someone to play.
  out.friends.sort((a, b) => Number(b.online) - Number(a.online) || a.user.displayName.localeCompare(b.user.displayName));
  return out;
}

export type FriendActionResult = { ok: true; status: string } | { ok: false; error: string };

/**
 * Sends a request, or accepts one that already exists in the other direction.
 *
 * Handling the reverse-pending case here is what makes "add" idempotent from
 * the user's point of view: if you both press add, you end up friends rather
 * than with two stuck requests.
 */
export async function requestFriend(userId: string, targetId: string): Promise<FriendActionResult> {
  if (userId === targetId) return { ok: false, error: 'You cannot add yourself' };

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false, error: 'No such player' };

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: userId, addresseeId: targetId },
        { requesterId: targetId, addresseeId: userId },
      ],
    },
  });

  if (existing) {
    if (existing.status === 'accepted') return { ok: false, error: 'Already friends' };
    if (existing.status === 'blocked') return { ok: false, error: 'Cannot add that player' };
    if (existing.requesterId === targetId) {
      await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      return { ok: true, status: 'accepted' };
    }
    return { ok: false, error: 'Request already sent' };
  }

  await prisma.friendship.create({
    data: { requesterId: userId, addresseeId: targetId, status: 'pending' },
  });
  return { ok: true, status: 'pending' };
}

export async function respondToFriend(
  userId: string,
  requesterId: string,
  accept: boolean,
): Promise<FriendActionResult> {
  const row = await prisma.friendship.findFirst({
    where: { requesterId, addresseeId: userId, status: 'pending' },
  });
  if (!row) return { ok: false, error: 'No pending request from that player' };

  if (accept) {
    await prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'accepted', respondedAt: new Date() },
    });
    return { ok: true, status: 'accepted' };
  }
  await prisma.friendship.delete({ where: { id: row.id } });
  return { ok: true, status: 'declined' };
}

export async function removeFriend(userId: string, otherId: string): Promise<FriendActionResult> {
  const { count } = await prisma.friendship.deleteMany({
    where: {
      OR: [
        { requesterId: userId, addresseeId: otherId },
        { requesterId: otherId, addresseeId: userId },
      ],
    },
  });
  return count ? { ok: true, status: 'removed' } : { ok: false, error: 'Not on your list' };
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const row = await prisma.friendship.findFirst({
    where: {
      status: 'accepted',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return Boolean(row);
}

/** Everyone who would want to know that this user's status changed. */
export async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'accepted',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

/** Name search for the add-friend box. Excludes guests and yourself. */
export async function searchPlayers(query: string, excludeId: string): Promise<PublicUser[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const rows = await prisma.user.findMany({
    where: {
      id: { not: excludeId },
      isGuest: false,
      OR: [{ displayName: { contains: term } }, { username: { contains: term } }],
    },
    take: 12,
    orderBy: { lastSeenAt: 'desc' },
  });
  return rows.map((r) => toPublicUser(r));
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

const RANGE_MS: Record<StatsRange, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

/** How wide each point on the graph is, chosen so every range plots ~72 points. */
const BUCKET_MS: Record<StatsRange, number> = {
  day: 20 * 60 * 1000,
  week: 2 * 60 * 60 * 1000,
  month: 8 * 60 * 60 * 1000,
};

export async function recordPlayerSample(sample: {
  online: number;
  inGame: number;
  rooms: number;
}): Promise<void> {
  try {
    await prisma.playerSample.create({ data: sample });
  } catch (err) {
    log.error('stats: could not write player sample', err);
  }
}

/** Samples older than the longest range are dead weight. */
export async function prunePlayerSamples(): Promise<void> {
  const cutoff = new Date(Date.now() - RANGE_MS.month - RANGE_MS.week);
  await prisma.playerSample.deleteMany({ where: { takenAt: { lt: cutoff } } }).catch(() => undefined);
}

export async function serverStats(range: StatsRange): Promise<ServerStats> {
  const since = new Date(Date.now() - RANGE_MS[range]);
  const bucket = BUCKET_MS[range];

  const samples = await prisma.playerSample.findMany({
    where: { takenAt: { gte: since } },
    orderBy: { takenAt: 'asc' },
  });

  // Bucket by time and take the PEAK within each bucket rather than the mean.
  // An average flattens exactly the spikes the graph exists to show.
  const buckets = new Map<number, StatsPoint>();
  for (const s of samples) {
    const t = Math.floor(s.takenAt.getTime() / bucket) * bucket;
    const current = buckets.get(t);
    if (!current) {
      buckets.set(t, { t, online: s.online, inGame: s.inGame, rooms: s.rooms });
    } else {
      current.online = Math.max(current.online, s.online);
      current.inGame = Math.max(current.inGame, s.inGame);
      current.rooms = Math.max(current.rooms, s.rooms);
    }
  }

  const points = [...buckets.values()].sort((a, b) => a.t - b.t);

  const peakRow = await prisma.playerSample.findFirst({
    orderBy: [{ online: 'desc' }, { takenAt: 'desc' }],
  });

  const [players, matches, guesses, wordsAgg] = await Promise.all([
    prisma.user.count(),
    prisma.match.count(),
    prisma.guess.count(),
    prisma.user.aggregate({ _sum: { wordsFound: true } }),
  ]);

  return {
    range,
    points,
    peak: { online: peakRow?.online ?? 0, at: peakRow?.takenAt.getTime() ?? Date.now() },
    current: {
      online: onlineCount(),
      inGame: points[points.length - 1]?.inGame ?? 0,
      rooms: points[points.length - 1]?.rooms ?? 0,
    },
    totals: {
      players,
      matches,
      guesses,
      wordsFound: wordsAgg._sum.wordsFound ?? 0,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Match replay
 * ------------------------------------------------------------------ */

/**
 * Every player's route through a finished match.
 *
 * Guesses are already stored per round with their rank and the millisecond they
 * were played, so the path is just those rows in play order — no reconstruction
 * needed.
 */
export async function matchReplay(matchId: string): Promise<MatchReplay | null> {
  const match = await prisma.match.findUnique({
    where: { id: matchId },
    include: {
      rounds: { orderBy: { index: 'asc' } },
      players: { include: { user: true }, orderBy: { placement: 'asc' } },
      guesses: { include: { user: true }, orderBy: [{ round: 'asc' }, { msIntoRound: 'asc' }] },
    },
  });
  if (!match) return null;

  const secretFor = new Map(match.rounds.map((r) => [r.index, r.secret]));
  const paths = new Map<string, GuessPath>();

  for (const g of match.guesses) {
    const key = `${g.userId}:${g.round}`;
    let path = paths.get(key);
    if (!path) {
      path = {
        user: toPublicUser(g.user),
        round: g.round,
        secret: secretFor.get(g.round) ?? '',
        found: false,
        guesses: [],
        bestRank: null,
        totalGuesses: 0,
      };
      paths.set(key, path);
    }
    path.guesses.push({
      word: g.word,
      rank: g.rank,
      stolen: g.stolen,
      isHint: g.isHint,
      msIntoRound: g.msIntoRound,
    });
    path.totalGuesses += 1;
    if (path.bestRank === null || g.rank < path.bestRank) path.bestRank = g.rank;
    if (g.rank === 1) path.found = true;
  }

  return {
    matchId: match.id,
    mode: match.mode as MatchReplay['mode'],
    playedAt: match.startedAt.getTime(),
    rounds: match.rounds.map((r) => ({ index: r.index, secret: r.secret })),
    players: match.players.map((p) => ({
      user: toPublicUser(p.user),
      placement: p.placement,
      score: p.score,
      wordsFound: p.wordsFound,
      totalGuesses: p.totalGuesses,
    })),
    paths: [...paths.values()].sort((a, b) => a.round - b.round || a.user.displayName.localeCompare(b.user.displayName)),
  };
}
