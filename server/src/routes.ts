import { Router, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import {
  ACHIEVEMENTS,
  BASE_RATING,
  bandForRank,
  defaultsForMode,
  levelFromXp,
  MODE_LIST,
  rankProgress,
  sanitizeSettings,
  xpForLevel,
  type DailyChallengeState,
  type GameMode,
  type GuessResult,
  type LeaderboardRow,
  type ProfileStats,
} from '@mivimoose/shared';
import {
  exchangeCode,
  fetchDiscordUser,
  optionalAuth,
  requireAuth,
  signSession,
} from './auth.js';
import {
  createGuestUser,
  displayRating,
  ensureGuildMembership,
  prisma,
  toPublicUser,
  upsertUserFromDiscord,
} from './db.js';
import { dailyWordFor, todayKey } from './engine/lexicon.js';
import { getRankTable, rankerStats, rankOf, resolveWord } from './engine/ranker.js';
import { log } from './log.js';

/**
 * Express 4 does not forward rejections from async handlers: a throw inside one
 * becomes an unhandled rejection and takes the whole process down rather than
 * returning a 500. Wrapping every handler routes failures to the error
 * middleware instead, which is what we actually want.
 */
function wrapHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function asyncRouter(): Router {
  const router = Router();
  for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
    const original = router[method].bind(router) as (
      path: string,
      ...handlers: RequestHandler[]
    ) => Router;
    (router as unknown as Record<string, unknown>)[method] = (
      path: string,
      ...handlers: RequestHandler[]
    ) => original(path, ...handlers.map(wrapHandler));
  }
  return router;
}

export function createApiRouter() {
  const router = asyncRouter();

  const authLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false });
  const guessLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false });

  /* ---------------------------------------------------------------- *
   * Auth
   * ---------------------------------------------------------------- */

  /**
   * The embedded SDK gives the client an OAuth2 code. It comes here, we swap it
   * for an access token using the client secret, read the Discord profile, and
   * hand back our own session JWT. The Discord token never goes to the browser.
   */
  router.post('/token', authLimiter, async (req, res) => {
    const parsed = z
      .object({ code: z.string().min(1), guildId: z.string().nullish(), channelId: z.string().nullish() })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A "code" is required' });
      return;
    }

    try {
      const tokens = await exchangeCode(parsed.data.code);
      const profile = await fetchDiscordUser(tokens.access_token);
      const user = await upsertUserFromDiscord(profile);
      await ensureGuildMembership(parsed.data.guildId ?? null, user.id);

      const rating = await displayRating(user.id);
      res.json({
        // The client needs the Discord access token to complete
        // discordSdk.commands.authenticate().
        access_token: tokens.access_token,
        token: signSession({ sub: user.id, did: user.discordId, gid: parsed.data.guildId ?? null }),
        user: toPublicUser(user, rating),
      });
    } catch (err) {
      log.error('auth: token exchange failed', err);
      res.status(401).json({ error: 'Discord rejected that login' });
    }
  });

  /**
   * Guest sign-in, available in production as well as locally. Anyone can open
   * the site, pick a name and play against other guests without linking a
   * Discord account. Each call mints a fresh throwaway account, so two browser
   * tabs are genuinely two players.
   */
  const guestHandler: RequestHandler = async (req, res) => {
    const name = z.string().max(24).optional().catch(undefined).parse(req.body?.name);
    const user = await createGuestUser(name);
    res.json({
      token: signSession({ sub: user.id, did: user.discordId, gid: null }),
      user: toPublicUser(user),
    });
  };

  router.post('/guest', authLimiter, guestHandler);
  /** Alias kept so the smoke tests and any older client keep working. */
  router.post('/dev-login', authLimiter, guestHandler);

  router.get('/me', requireAuth, async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session!.sub } });
    if (!user) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    const rating = await displayRating(user.id);
    res.json(toPublicUser(user, rating));
  });

  /* ---------------------------------------------------------------- *
   * Reference data
   * ---------------------------------------------------------------- */

  router.get('/modes', (_req, res) => {
    res.json({ modes: MODE_LIST, defaults: Object.fromEntries(MODE_LIST.map((m) => [m.id, defaultsForMode(m.id)])) });
  });

  router.get('/health', (_req, res) => {
    res.json({ ok: true, engine: rankerStats(), uptime: Math.round(process.uptime()) });
  });

  /* ---------------------------------------------------------------- *
   * Leaderboards
   * ---------------------------------------------------------------- */

  router.get('/leaderboard', optionalAuth, async (req, res) => {
    const query = z
      .object({
        metric: z.enum(['rating', 'wins', 'xp', 'streak', 'wordsFound']).catch('xp'),
        scope: z.enum(['global', 'guild']).catch('global'),
        mode: z.string().optional(),
        guildId: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).catch(25),
      })
      .parse(req.query);

    const meId = req.session?.sub ?? null;

    // The rating ladder lives in its own table, so it is a different query.
    if (query.metric === 'rating') {
      const mode = (query.mode ?? 'duel') as GameMode;
      const rows = await prisma.rating.findMany({
        where: {
          mode,
          matches: { gt: 0 },
          user: {
            // Guests are throwaway accounts: they play, but they do not rank.
            isGuest: false,
            ...(query.scope === 'guild' && query.guildId
              ? { memberships: { some: { guildId: query.guildId } } }
              : {}),
          },
        },
        orderBy: [{ rating: 'desc' }, { wins: 'desc' }],
        take: query.limit,
        include: { user: true },
      });
      const out: LeaderboardRow[] = rows.map((row, i) => ({
        rank: i + 1,
        user: toPublicUser(row.user, row.rating),
        value: row.rating,
        matches: row.matches,
        wins: row.wins,
        winRate: row.matches ? row.wins / row.matches : 0,
        isMe: row.userId === meId,
      }));
      res.json({ metric: query.metric, mode, rows: out });
      return;
    }

    const orderBy =
      query.metric === 'wins'
        ? [{ wins: 'desc' as const }, { xp: 'desc' as const }]
        : query.metric === 'streak'
          ? [{ bestStreak: 'desc' as const }, { wins: 'desc' as const }]
          : query.metric === 'wordsFound'
            ? [{ wordsFound: 'desc' as const }, { wins: 'desc' as const }]
            : [{ xp: 'desc' as const }, { wins: 'desc' as const }];

    const users = await prisma.user.findMany({
      where: {
        matches: { gt: 0 },
        isGuest: false,
        ...(query.scope === 'guild' && query.guildId
          ? { memberships: { some: { guildId: query.guildId } } }
          : {}),
      },
      orderBy,
      take: query.limit,
    });

    const value = (u: (typeof users)[number]) =>
      query.metric === 'wins'
        ? u.wins
        : query.metric === 'streak'
          ? u.bestStreak
          : query.metric === 'wordsFound'
            ? u.wordsFound
            : u.xp;

    const rows: LeaderboardRow[] = users.map((u, i) => ({
      rank: i + 1,
      user: toPublicUser(u),
      value: value(u),
      matches: u.matches,
      wins: u.wins,
      winRate: u.matches ? u.wins / u.matches : 0,
      isMe: u.id === meId,
    }));
    res.json({ metric: query.metric, rows });
  });

  /* ---------------------------------------------------------------- *
   * Profiles
   * ---------------------------------------------------------------- */

  router.get('/profile/:userId?', requireAuth, async (req, res) => {
    const userId = req.params.userId ?? req.session!.sub;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        ratings: true,
        achievements: true,
        participants: {
          orderBy: { match: { startedAt: 'desc' } },
          take: 12,
          include: { match: { select: { id: true, mode: true, playerCount: true, startedAt: true } } },
        },
      },
    });
    if (!user) {
      res.status(404).json({ error: 'No such player' });
      return;
    }

    const { level, into } = levelFromXp(user.xp);
    const duelRating = user.ratings.find((r) => r.mode === 'duel')?.rating ?? BASE_RATING;
    const unlocked = new Map(user.achievements.map((a) => [a.achievementId, a.unlockedAt.getTime()]));

    const stats: ProfileStats = {
      user: toPublicUser(user, duelRating),
      level,
      xp: user.xp,
      xpIntoLevel: into,
      xpForLevel: xpForLevel(level),
      matches: user.matches,
      wins: user.wins,
      winRate: user.matches ? user.wins / user.matches : 0,
      wordsFound: user.wordsFound,
      averageGuesses: user.wordsFound ? user.totalGuesses / user.wordsFound : 0,
      fastestFindMs: user.fastestFindMs,
      currentStreak: user.currentStreak,
      bestStreak: user.bestStreak,
      perMode: user.ratings.map((r) => ({
        mode: r.mode as GameMode,
        matches: r.matches,
        wins: r.wins,
        rating: r.rating,
      })),
      recent: user.participants.map((p) => ({
        matchId: p.match.id,
        mode: p.match.mode as GameMode,
        placement: p.placement,
        players: p.match.playerCount,
        playedAt: p.match.startedAt.getTime(),
      })),
      achievements: ACHIEVEMENTS.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        icon: a.icon,
        unlockedAt: unlocked.get(a.id) ?? null,
      })),
    };
    res.json(stats);
  });

  router.get('/match/:matchId', requireAuth, async (req, res) => {
    const match = await prisma.match.findUnique({
      where: { id: req.params.matchId },
      include: {
        rounds: { orderBy: { index: 'asc' } },
        players: { include: { user: true }, orderBy: { placement: 'asc' } },
      },
    });
    if (!match) {
      res.status(404).json({ error: 'No such match' });
      return;
    }
    res.json({
      id: match.id,
      mode: match.mode,
      ranked: match.ranked,
      playedAt: match.startedAt.getTime(),
      settings: JSON.parse(match.settings),
      rounds: match.rounds.map((r) => ({ index: r.index, secret: r.secret })),
      players: match.players.map((p) => ({
        user: toPublicUser(p.user),
        placement: p.placement,
        score: p.score,
        wordsFound: p.wordsFound,
        totalGuesses: p.totalGuesses,
        ratingBefore: p.ratingBefore,
        ratingAfter: p.ratingAfter,
      })),
    });
  });

  /* ---------------------------------------------------------------- *
   * Daily challenge
   * ---------------------------------------------------------------- */

  async function loadDaily(date: string) {
    const word = dailyWordFor(date);
    return prisma.dailyWord.upsert({
      where: { date },
      create: { date, word },
      update: {},
    });
  }

  async function dailyState(userId: string, date = todayKey()): Promise<DailyChallengeState> {
    const daily = await loadDaily(date);
    const entry = await prisma.dailyEntry.findUnique({
      where: { dailyId_userId: { dailyId: daily.id, userId } },
    });
    const [totalSolvers, best] = await Promise.all([
      prisma.dailyEntry.count({ where: { dailyId: daily.id, solved: true } }),
      prisma.dailyEntry.findFirst({
        where: { dailyId: daily.id, solved: true },
        orderBy: { guessCount: 'asc' },
        select: { guessCount: true },
      }),
    ]);

    let standing: number | null = null;
    if (entry?.solved) {
      const better = await prisma.dailyEntry.count({
        where: { dailyId: daily.id, solved: true, guessCount: { lt: entry.guessCount } },
      });
      standing = better + 1;
    }

    return {
      date,
      guesses: entry ? (JSON.parse(entry.guesses) as GuessResult[]) : [],
      solved: entry?.solved ?? false,
      guessCount: entry?.guessCount ?? 0,
      standing,
      totalSolvers,
      bestGuessCount: best?.guessCount ?? null,
    };
  }

  router.get('/daily', requireAuth, async (req, res) => {
    res.json(await dailyState(req.session!.sub));
  });

  router.post('/daily/guess', requireAuth, guessLimiter, async (req, res) => {
    const parsed = z.object({ word: z.string().min(1).max(32) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A "word" is required' });
      return;
    }

    const date = todayKey();
    const daily = await loadDaily(date);
    const userId = req.session!.sub;

    const entry = await prisma.dailyEntry.upsert({
      where: { dailyId_userId: { dailyId: daily.id, userId } },
      create: { dailyId: daily.id, userId },
      update: {},
    });
    if (entry.solved) {
      res.status(409).json({ error: 'You already solved today' });
      return;
    }

    const resolved = resolveWord(parsed.data.word);
    if (!resolved) {
      res.status(422).json({ error: `"${parsed.data.word.toLowerCase()}" is not in the word list`, code: 'unknown-word' });
      return;
    }

    const guesses = JSON.parse(entry.guesses) as GuessResult[];
    if (guesses.some((g) => g.word === resolved.word)) {
      res.status(409).json({ error: `You already played "${resolved.word}"`, code: 'already-guessed' });
      return;
    }

    const table = getRankTable(daily.word);
    const rank = rankOf(table, resolved.index);
    if (rank === null) {
      res.status(422).json({ error: `"${resolved.word}" is too obscure to rank`, code: 'unknown-word' });
      return;
    }

    const result: GuessResult = {
      id: nanoid(10),
      word: resolved.word,
      rank,
      band: bandForRank(rank),
      progress: rankProgress(rank, table.depth),
      at: Date.now(),
      playerId: userId,
      repeat: false,
      isHint: false,
    };
    guesses.push(result);

    const solved = rank === 1;
    await prisma.dailyEntry.update({
      where: { id: entry.id },
      data: {
        guesses: JSON.stringify(guesses),
        guessCount: guesses.length,
        solved,
        solvedAt: solved ? new Date() : undefined,
      },
    });

    if (solved) {
      await prisma.user.update({
        where: { id: userId },
        data: { wordsFound: { increment: 1 }, xp: { increment: 120 } },
      });
    }

    res.json({ result, state: await dailyState(userId, date) });
  });

  router.get('/daily/leaderboard', optionalAuth, async (req, res) => {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(todayKey()).parse(req.query.date);
    const daily = await loadDaily(date);
    const entries = await prisma.dailyEntry.findMany({
      where: { dailyId: daily.id, solved: true },
      orderBy: [{ guessCount: 'asc' }, { solvedAt: 'asc' }],
      take: 50,
      include: { user: true },
    });
    res.json({
      date,
      rows: entries.map((e, i) => ({
        rank: i + 1,
        user: toPublicUser(e.user),
        value: e.guessCount,
        matches: 0,
        wins: 0,
        winRate: 0,
        isMe: e.userId === req.session?.sub,
      })),
    });
  });

  /* ---------------------------------------------------------------- *
   * Custom game presets
   * ---------------------------------------------------------------- */

  router.get('/presets', requireAuth, async (req, res) => {
    const [mine, featured] = await Promise.all([
      prisma.gamePreset.findMany({ where: { ownerId: req.session!.sub }, orderBy: { createdAt: 'desc' } }),
      prisma.gamePreset.findMany({
        where: { isPublic: true, ownerId: { not: req.session!.sub } },
        orderBy: { uses: 'desc' },
        take: 12,
        include: { owner: { select: { displayName: true } } },
      }),
    ]);
    const shape = (p: { id: string; name: string; shareCode: string; settings: string; uses: number; isPublic: boolean }) => ({
      id: p.id,
      name: p.name,
      shareCode: p.shareCode,
      settings: JSON.parse(p.settings),
      uses: p.uses,
      isPublic: p.isPublic,
    });
    res.json({
      mine: mine.map(shape),
      featured: featured.map((p) => ({ ...shape(p), author: p.owner.displayName })),
    });
  });

  router.post('/presets', requireAuth, async (req, res) => {
    const parsed = z
      .object({
        name: z.string().min(1).max(48),
        isPublic: z.boolean().optional(),
        settings: z.record(z.unknown()),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A name and settings are required' });
      return;
    }

    const mode = (parsed.data.settings.mode as GameMode) ?? 'classic';
    const settings = sanitizeSettings(parsed.data.settings as never, defaultsForMode(mode));
    const preset = await prisma.gamePreset.create({
      data: {
        ownerId: req.session!.sub,
        name: parsed.data.name,
        shareCode: nanoid(8).toUpperCase(),
        settings: JSON.stringify(settings),
        isPublic: parsed.data.isPublic ?? false,
      },
    });
    res.status(201).json({ id: preset.id, name: preset.name, shareCode: preset.shareCode, settings });
  });

  router.get('/presets/:shareCode', optionalAuth, async (req, res) => {
    const preset = await prisma.gamePreset.findUnique({
      where: { shareCode: req.params.shareCode.toUpperCase() },
      include: { owner: { select: { displayName: true } } },
    });
    if (!preset) {
      res.status(404).json({ error: 'No preset with that code' });
      return;
    }
    await prisma.gamePreset.update({ where: { id: preset.id }, data: { uses: { increment: 1 } } });
    res.json({
      id: preset.id,
      name: preset.name,
      shareCode: preset.shareCode,
      author: preset.owner.displayName,
      settings: JSON.parse(preset.settings),
    });
  });

  router.delete('/presets/:id', requireAuth, async (req, res) => {
    const preset = await prisma.gamePreset.findUnique({ where: { id: req.params.id } });
    if (!preset || preset.ownerId !== req.session!.sub) {
      res.status(404).json({ error: 'No such preset' });
      return;
    }
    await prisma.gamePreset.delete({ where: { id: preset.id } });
    res.status(204).end();
  });

  /* ---------------------------------------------------------------- *
   * Word list validation for custom games
   * ---------------------------------------------------------------- */

  router.post('/words/validate', requireAuth, (req, res) => {
    const parsed = z.object({ words: z.array(z.string()).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Send a "words" array' });
      return;
    }
    const checked = parsed.data.words.map((raw) => {
      const resolved = resolveWord(raw);
      return {
        input: raw,
        ok: Boolean(resolved),
        word: resolved?.word ?? null,
        note: resolved?.normalizedFrom ? `matched as "${resolved.word}"` : null,
      };
    });
    res.json({ words: checked, usable: checked.filter((c) => c.ok).map((c) => c.word) });
  });

  return router;
}
