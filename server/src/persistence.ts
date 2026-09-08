import {
  ACHIEVEMENTS,
  BASE_RATING,
  computeRatingDeltas,
  modeSupportsRanked,
  xpForMatch,
  type MatchResult,
} from '@mivimoose/shared';
import { prisma } from './db.js';
import { log } from './log.js';
import type { Room } from './game/Room.js';

/**
 * Writes a finished match to the database and enriches the result payload with
 * the numbers the client wants to animate: rating movement and XP.
 *
 * Deliberately best-effort. A database hiccup must not stop players seeing
 * their results screen, so every failure is logged and swallowed and the
 * unaugmented result is returned.
 */
export async function recordMatch(room: Room, result: MatchResult): Promise<MatchResult> {
  const players = room.activePlayers;
  if (players.length === 0) return result;

  try {
    const ranked = room.settings.ranked && modeSupportsRanked(room.settings.mode);

    // Current ratings up front so we can report before/after.
    const ratingRows = ranked
      ? await Promise.all(
          players.map((p) =>
            prisma.rating.upsert({
              where: { userId_mode: { userId: p.user.id, mode: room.settings.mode } },
              create: { userId: p.user.id, mode: room.settings.mode },
              update: {},
            }),
          ),
        )
      : [];
    const ratingByUser = new Map(ratingRows.map((r) => [r.userId, r]));

    const deltas = ranked
      ? computeRatingDeltas(
          result.entries.map((e) => ({
            playerId: e.playerId,
            rating: ratingByUser.get(e.playerId)?.rating ?? BASE_RATING,
            matches: ratingByUser.get(e.playerId)?.matches ?? 0,
            placement: e.placement,
          })),
        )
      : {};

    await prisma.match.create({
      data: {
        id: result.matchId,
        code: room.code,
        mode: room.settings.mode,
        settings: JSON.stringify(room.settings),
        guildId: room.guildId ?? undefined,
        ranked,
        playerCount: players.length,
        endedAt: new Date(),
        rounds: {
          create: room.rounds.map((r) => ({
            index: r.round,
            secret: r.secret,
            endedAt: new Date(),
          })),
        },
      },
    });

    if (room.matchGuessLog.length) {
      // createMany keeps a 10-player, 10-round match to a single round trip.
      await prisma.guess.createMany({
        data: room.matchGuessLog.map((g) => ({
          matchId: result.matchId,
          userId: g.userId,
          round: g.round,
          word: g.word,
          rank: g.rank,
          isHint: g.isHint,
          msIntoRound: g.msIntoRound,
        })),
      });
    }

    const augmented: MatchResult = { ...result, entries: [] };

    for (const entry of result.entries) {
      const player = players.find((p) => p.user.id === entry.playerId);
      const won = entry.placement === 1;
      const xpGained = xpForMatch(entry.score, entry.placement, players.length);
      const ratingRow = ratingByUser.get(entry.playerId);
      const delta = deltas[entry.playerId] ?? 0;
      const ratingBefore = ratingRow?.rating ?? null;
      const ratingAfter = ratingRow ? ratingRow.rating + delta : null;

      await prisma.matchPlayer.create({
        data: {
          matchId: result.matchId,
          userId: entry.playerId,
          placement: entry.placement,
          score: entry.score,
          wordsFound: entry.wordsFound,
          totalGuesses: entry.totalGuesses,
          bestRank: entry.bestRank ?? undefined,
          ratingBefore: ratingBefore ?? undefined,
          ratingAfter: ratingAfter ?? undefined,
          xpGained,
        },
      });

      if (ranked && ratingRow && ratingAfter !== null) {
        await prisma.rating.update({
          where: { id: ratingRow.id },
          data: {
            rating: ratingAfter,
            peak: Math.max(ratingRow.peak, ratingAfter),
            matches: { increment: 1 },
            wins: won ? { increment: 1 } : undefined,
          },
        });
      }

      const fastest = player?.foundAt ?? null;
      const existing = await prisma.user.findUnique({
        where: { id: entry.playerId },
        select: { fastestFindMs: true, currentStreak: true, bestStreak: true },
      });
      const nextStreak = won ? (existing?.currentStreak ?? 0) + 1 : 0;

      await prisma.user.update({
        where: { id: entry.playerId },
        data: {
          xp: { increment: xpGained },
          matches: { increment: 1 },
          wins: won ? { increment: 1 } : undefined,
          wordsFound: { increment: entry.wordsFound },
          totalGuesses: { increment: entry.totalGuesses },
          currentStreak: nextStreak,
          bestStreak: Math.max(existing?.bestStreak ?? 0, nextStreak),
          fastestFindMs:
            fastest !== null && (existing?.fastestFindMs === null || existing?.fastestFindMs === undefined || fastest < existing.fastestFindMs)
              ? fastest
              : undefined,
          lastSeenAt: new Date(),
        },
      });

      augmented.entries.push({ ...entry, ratingBefore, ratingAfter, xpGained });
    }

    await evaluateAchievements(room, augmented);
    log.info(`match ${result.matchId}: recorded (${room.settings.mode}, ${players.length} players)`);
    return augmented;
  } catch (err) {
    log.error('persistence: failed to record match', err);
    return result;
  }
}

const ACHIEVEMENT_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

async function unlock(userId: string, achievementId: string): Promise<void> {
  if (!ACHIEVEMENT_IDS.has(achievementId)) return;
  await prisma.userAchievement
    .create({ data: { userId, achievementId } })
    .catch(() => undefined); // unique constraint = already unlocked
}

async function evaluateAchievements(room: Room, result: MatchResult): Promise<void> {
  for (const entry of result.entries) {
    const player = room.activePlayers.find((p) => p.user.id === entry.playerId);
    if (!player) continue;

    const roundsFor = room.rounds.flatMap((r) => r.entries.filter((e) => e.playerId === entry.playerId));
    const solved = roundsFor.filter((r) => r.foundAt !== null);

    if (entry.placement === 1) await unlock(entry.playerId, 'first-blood');
    if (solved.some((r) => r.guessCount === 1)) await unlock(entry.playerId, 'one-shot');
    if (solved.some((r) => r.guessCount <= 5)) await unlock(entry.playerId, 'sniper');
    if (solved.some((r) => (r.foundAt ?? Infinity) < 15_000)) await unlock(entry.playerId, 'speed-demon');
    if (entry.placement === 1 && room.settings.mode === 'elimination' && room.activePlayers.length >= 8) {
      await unlock(entry.playerId, 'survivor');
    }
    if (
      room.settings.mode === 'marathon' &&
      roundsFor.length >= 10 &&
      roundsFor.every((r) => r.placement <= 3)
    ) {
      await unlock(entry.playerId, 'marathoner');
    }
    if (
      roundsFor.some((r) => r.placement === 1 && (r.bestRank ?? 0) > 500 && r.foundAt === null)
    ) {
      await unlock(entry.playerId, 'cold-blooded');
    }

    const user = await prisma.user.findUnique({
      where: { id: entry.playerId },
      select: { wordsFound: true, stolenWords: true },
    });
    if ((user?.wordsFound ?? 0) >= 100) await unlock(entry.playerId, 'centurion');
    if ((user?.stolenWords ?? 0) >= 50) await unlock(entry.playerId, 'thief');

    if (room.settings.mode === 'duel' && entry.placement === 1) {
      const duelWins = await prisma.rating.findUnique({
        where: { userId_mode: { userId: entry.playerId, mode: 'duel' } },
        select: { wins: true },
      });
      if ((duelWins?.wins ?? 0) >= 10) await unlock(entry.playerId, 'duelist');
    }

    if (entry.placement === 1) {
      const wonModes = await prisma.matchPlayer.findMany({
        where: { userId: entry.playerId, placement: 1 },
        select: { match: { select: { mode: true } } },
      });
      const distinct = new Set(wonModes.map((m) => m.match.mode));
      if (distinct.size >= 7) await unlock(entry.playerId, 'polyglot');
    }
  }
}
