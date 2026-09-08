import { PrismaClient } from '@prisma/client';
import { BASE_RATING, type GameMode, type PublicUser } from '@mivimoose/shared';
import { env } from './env.js';

export const prisma = new PrismaClient({
  log: env.isProd ? ['warn', 'error'] : ['warn', 'error'],
});

export interface DiscordProfile {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  locale?: string | null;
}

export function avatarUrl(discordId: string, avatar: string | null | undefined): string | null {
  if (!avatar) {
    // Discord's default avatars for the post-discriminator username system.
    // Seeded and dev-login accounts do not have snowflake ids, so fall back to
    // a stable hash rather than blowing up on BigInt().
    const index = /^\d+$/.test(discordId)
      ? Number((BigInt(discordId) >> 22n) % 6n)
      : hashToRange(discordId, 6);
    return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
  }
  const ext = avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.${ext}?size=128`;
}

function hashToRange(input: string, buckets: number): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % buckets;
}

export async function upsertUserFromDiscord(profile: DiscordProfile) {
  const displayName = profile.global_name?.trim() || profile.username;
  return prisma.user.upsert({
    where: { discordId: profile.id },
    create: {
      discordId: profile.id,
      username: profile.username,
      displayName,
      avatar: profile.avatar ?? null,
      locale: profile.locale ?? null,
    },
    update: {
      username: profile.username,
      displayName,
      avatar: profile.avatar ?? null,
      lastSeenAt: new Date(),
    },
  });
}

type UserRow = Awaited<ReturnType<typeof upsertUserFromDiscord>>;

export function toPublicUser(user: UserRow, rating = BASE_RATING): PublicUser {
  return {
    id: user.id,
    discordId: user.discordId,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: avatarUrl(user.discordId, user.avatar),
    rating,
    title: user.title ?? null,
    isGuest: user.isGuest,
  };
}

const GUEST_ADJECTIVES = [
  'Swift', 'Quiet', 'Clever', 'Lucky', 'Bold', 'Curious', 'Sly', 'Bright',
  'Restless', 'Patient', 'Wry', 'Keen', 'Odd', 'Brisk', 'Calm', 'Sharp',
];
const GUEST_NOUNS = [
  'Moose', 'Otter', 'Heron', 'Badger', 'Falcon', 'Marten', 'Lynx', 'Wren',
  'Stoat', 'Osprey', 'Ferret', 'Magpie', 'Weasel', 'Puffin', 'Shrike', 'Vole',
];

/**
 * Creates a throwaway account. Every guest is a real row with a real id, so a
 * guest can host rooms, hold a socket session and reconnect mid-match exactly
 * like a Discord player — they are simply flagged and kept off the ladders.
 */
export async function createGuestUser(requestedName?: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const adjective = GUEST_ADJECTIVES[Math.floor(Math.random() * GUEST_ADJECTIVES.length)];
  const noun = GUEST_NOUNS[Math.floor(Math.random() * GUEST_NOUNS.length)];

  const cleaned = (requestedName ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
  const displayName = cleaned.length >= 2 ? cleaned : `${adjective} ${noun}`;

  return prisma.user.create({
    data: {
      discordId: `guest-${suffix}-${Date.now().toString(36)}`,
      username: displayName.toLowerCase().replace(/[^a-z0-9]/g, '') || `guest${suffix}`,
      displayName,
      isGuest: true,
    },
  });
}

export async function getRating(userId: string, mode: GameMode) {
  return prisma.rating.upsert({
    where: { userId_mode: { userId, mode } },
    create: { userId, mode },
    update: {},
  });
}

/** The rating we show on a player card: their duel Elo, the ladder that matters. */
export async function displayRating(userId: string): Promise<number> {
  const row = await prisma.rating.findUnique({ where: { userId_mode: { userId, mode: 'duel' } } });
  return row?.rating ?? BASE_RATING;
}

export async function ensureGuildMembership(guildId: string | null, userId: string, guildName?: string) {
  if (!guildId) return;
  await prisma.guild.upsert({
    where: { id: guildId },
    create: { id: guildId, name: guildName ?? 'Unknown server' },
    update: guildName ? { name: guildName } : {},
  });
  await prisma.guildMember.upsert({
    where: { guildId_userId: { guildId, userId } },
    create: { guildId, userId },
    update: {},
  });
}
