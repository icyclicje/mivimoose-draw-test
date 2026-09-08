import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// A server-local .env wins, then the repo-root one fills in the rest. One file
// at the root is enough for both workspaces; the local override exists for
// deployments that inject only the server's secrets.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config();
dotenv.config({ path: path.resolve(here, '../../.env') });

/**
 * Nothing here is required.
 *
 * The point is that `railway up` on a bare project boots a working game: guest
 * accounts, every mode, the daily, friends, the lot. Discord sign-in and a
 * stable session secret are upgrades you add when you want them, not a gate you
 * have to clear before the thing will start at all.
 *
 * What each omission costs is spelled out in the boot warnings below.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  // Both or neither. One on its own cannot complete an OAuth exchange.
  DISCORD_CLIENT_ID: z.string().trim().optional(),
  DISCORD_CLIENT_SECRET: z.string().trim().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),

  // Generated and persisted when absent. See resolveSessionSecret.
  SESSION_SECRET: z.string().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().default('file:./arena.db'),

  EMBEDDING_PROVIDER: z.enum(['auto', 'vectors', 'topic']).default('auto'),
  VECTOR_INDEX_PATH: z.string().default('./data/index.bin'),
  RANK_DEPTH: z.coerce.number().int().positive().default(200000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

/** Where a generated secret is kept so it survives a restart. */
function secretStorePath(): string {
  // On Railway a volume is the only thing that outlives a redeploy. Without
  // one, this still survives an in-place restart, which is the common case.
  const dir = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.resolve(here, '../data');
  return path.join(dir, '.session-secret');
}

interface SessionSecret {
  value: string;
  /** True when we made it up, which means it can change and log out everyone. */
  generated: boolean;
  /** True when we managed to write it down, so a restart keeps sessions alive. */
  persisted: boolean;
}

function resolveSessionSecret(explicit: string | undefined): SessionSecret {
  const trimmed = explicit?.trim();
  if (trimmed && trimmed.length >= 16) {
    return { value: trimmed, generated: false, persisted: true };
  }

  const file = secretStorePath();

  try {
    const saved = fs.readFileSync(file, 'utf8').trim();
    if (saved.length >= 16) return { value: saved, generated: true, persisted: true };
  } catch {
    // No file yet, or an unreadable one. Either way, make a new secret.
  }

  const value = crypto.randomBytes(48).toString('hex');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Owner-only: this signs every session token on the server.
    fs.writeFileSync(file, value, { mode: 0o600 });
    return { value, generated: true, persisted: true };
  } catch {
    // A read-only filesystem is fine. Sessions just do not survive a restart.
    return { value, generated: true, persisted: false };
  }
}

/**
 * Prisma does not go through any of this.
 *
 * `env("DATABASE_URL")` in schema.prisma is read from `process.env` by the
 * generated client, so a default that only exists in our zod schema leaves
 * PrismaClient with nothing and every query fails at runtime. Write the
 * resolved value back so there is one answer for both.
 *
 * Must agree with scripts/ensure-database-url.mjs, which does the same job for
 * the Prisma CLI during build and schema sync.
 */
function ensureDatabaseUrl(configured: string): string {
  const existing = process.env.DATABASE_URL?.trim();
  if (existing) return existing;

  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const resolved = volume
    ? `file:${path.join(volume, 'db', 'arena.db').split(path.sep).join('/')}`
    : configured;

  if (volume) {
    try {
      fs.mkdirSync(path.join(volume, 'db'), { recursive: true });
    } catch {
      // Falls back to whatever the schema default resolves to.
    }
  }

  process.env.DATABASE_URL = resolved;
  return resolved;
}

const databaseUrl = ensureDatabaseUrl(raw.DATABASE_URL);
const sessionSecret = resolveSessionSecret(raw.SESSION_SECRET);

const discordClientId = raw.DISCORD_CLIENT_ID || null;
const discordClientSecret = raw.DISCORD_CLIENT_SECRET || null;
/** Both halves, or the OAuth exchange cannot happen at all. */
const discordEnabled = Boolean(discordClientId && discordClientSecret);

export const env = {
  ...raw,
  DATABASE_URL: databaseUrl,
  SESSION_SECRET: sessionSecret.value,
  DISCORD_CLIENT_ID: discordClientId,
  DISCORD_CLIENT_SECRET: discordClientSecret,

  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  /** Discord sign-in and the Activity flow are available. */
  discordEnabled,
  /**
   * The origin Discord serves this Activity from, or null when no client id is
   * configured. CORS also allows any *.discordsays.com origin, so an Activity
   * still works the moment the id is added, with no redeploy of the allow-list.
   */
  activityOrigin: discordClientId ? `https://${discordClientId}.discordsays.com` : null,

  sessionSecretGenerated: sessionSecret.generated,
  sessionSecretPersisted: sessionSecret.persisted,
};

/**
 * Say what is missing and what it costs, once, at boot. Deliberately warnings
 * rather than errors: every one of these has a working fallback.
 */
export function reportEnvironment(log: {
  info: (m: string) => void;
  warn: (m: string) => void;
}): void {
  if (discordEnabled) {
    log.info(`discord sign-in enabled · activity origin ${env.activityOrigin}`);
  } else {
    const half = discordClientId || discordClientSecret;
    log.warn(
      half
        ? 'discord sign-in is off: DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET must both be set'
        : 'discord sign-in is off, so everyone plays as a guest. Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET to enable it.',
    );
  }

  if (env.sessionSecretGenerated) {
    log.warn(
      env.sessionSecretPersisted
        ? `SESSION_SECRET not set, so one was generated and saved to ${secretStorePath()}. Set SESSION_SECRET to keep sessions across redeploys.`
        : 'SESSION_SECRET not set and could not be saved. A new one is generated on every restart, so everyone is signed out when the server restarts.',
    );
  }
}

export type Env = typeof env;
