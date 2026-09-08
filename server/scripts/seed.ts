/**
 * Populates the database with demo players, ratings and finished matches so the
 * leaderboard and profile screens have something to render before anyone has
 * played. Safe to run repeatedly: everything is upserted by a stable key.
 *
 *   npm run seed
 */

import { GAME_MODES, type GameMode } from '@mivimoose/shared';
import { prisma } from '../src/db.js';
import { dailyWordFor, getLexicon, pickSecrets, todayKey } from '../src/engine/lexicon.js';

const DEMO_PLAYERS = [
  { name: 'Mivi', rating: 1642, xp: 18400 },
  { name: 'Moose', rating: 1588, xp: 15200 },
  { name: 'Peregrine', rating: 1521, xp: 12100 },
  { name: 'Halcyon', rating: 1470, xp: 9800 },
  { name: 'Quill', rating: 1432, xp: 8700 },
  { name: 'Marrow', rating: 1388, xp: 7400 },
  { name: 'Fennel', rating: 1301, xp: 6200 },
  { name: 'Cobweb', rating: 1244, xp: 4900 },
  { name: 'Tinder', rating: 1180, xp: 3600 },
  { name: 'Sable', rating: 1092, xp: 2100 },
];

function rng(seed: number) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

async function main() {
  const random = rng(20260906);
  console.log('Seeding Mivimoose Guess...');

  const lexicon = getLexicon();
  console.log(`  engine reports ${lexicon.entries.length} candidate secret words`);

  const users = [];
  for (const demo of DEMO_PLAYERS) {
    const discordId = `seed-${demo.name.toLowerCase()}`;
    const user = await prisma.user.upsert({
      where: { discordId },
      create: {
        discordId,
        username: demo.name.toLowerCase(),
        displayName: demo.name,
        xp: demo.xp,
        title: demo.rating > 1600 ? 'Lexicographer' : null,
      },
      update: { xp: demo.xp },
    });
    users.push({ ...demo, id: user.id });

    for (const mode of GAME_MODES) {
      const jitter = Math.round((random() - 0.5) * 160);
      const rating = mode === 'duel' ? demo.rating : Math.max(900, demo.rating + jitter);
      const matches = 8 + Math.floor(random() * 40);
      await prisma.rating.upsert({
        where: { userId_mode: { userId: user.id, mode } },
        create: { userId: user.id, mode, rating, peak: rating + 30, matches, wins: Math.floor(matches * random() * 0.6) },
        update: { rating, matches },
      });
    }
  }

  // A handful of completed matches so profiles have history.
  const existingMatches = await prisma.match.count();
  if (existingMatches < 20) {
    for (let m = 0; m < 24; m++) {
      const mode = GAME_MODES[Math.floor(random() * GAME_MODES.length)] as GameMode;
      const size = mode === 'duel' ? 2 : 3 + Math.floor(random() * 6);
      const roster = [...users].sort(() => random() - 0.5).slice(0, size);
      const rounds = mode === 'marathon' ? 6 : 3;
      const secrets = pickSecrets(rounds, { difficulty: 'normal', category: 'any', seed: `seed-${m}` });

      const match = await prisma.match.create({
        data: {
          code: `SD${m.toString().padStart(2, '0')}`,
          mode,
          settings: JSON.stringify({ mode, rounds, seeded: true }),
          ranked: mode === 'duel',
          playerCount: roster.length,
          startedAt: new Date(Date.now() - (m + 1) * 3_600_000),
          endedAt: new Date(Date.now() - (m + 1) * 3_600_000 + 600_000),
          rounds: { create: secrets.map((secret, i) => ({ index: i + 1, secret })) },
        },
      });

      const scored = roster
        .map((u) => ({ u, score: Math.floor(600 + random() * 3200) }))
        .sort((a, b) => b.score - a.score);

      for (let i = 0; i < scored.length; i++) {
        const { u, score } = scored[i];
        await prisma.matchPlayer.create({
          data: {
            matchId: match.id,
            userId: u.id,
            placement: i + 1,
            score,
            wordsFound: Math.max(0, rounds - i),
            totalGuesses: 14 + Math.floor(random() * 40),
            bestRank: 1 + Math.floor(random() * 40),
            xpGained: Math.floor(score / 8),
          },
        });
      }
    }
    console.log('  created 24 demo matches');
  }

  // Aggregate columns, recomputed from the demo matches.
  for (const u of users) {
    const played = await prisma.matchPlayer.findMany({ where: { userId: u.id } });
    await prisma.user.update({
      where: { id: u.id },
      data: {
        matches: played.length,
        wins: played.filter((p) => p.placement === 1).length,
        wordsFound: played.reduce((s, p) => s + p.wordsFound, 0),
        totalGuesses: played.reduce((s, p) => s + p.totalGuesses, 0),
        bestStreak: 1 + Math.floor(random() * 7),
      },
    });
  }

  const date = todayKey();
  await prisma.dailyWord.upsert({
    where: { date },
    create: { date, word: dailyWordFor(date) },
    update: {},
  });
  console.log(`  daily word for ${date} is locked in`);

  console.log('Done.');
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
