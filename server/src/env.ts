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

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_CLIENT_SECRET: z.string().min(1, 'DISCORD_CLIENT_SECRET is required'),
  DISCORD_BOT_TOKEN: z.string().optional(),

  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().default('file:./arena.db'),

  EMBEDDING_PROVIDER: z.enum(['auto', 'vectors', 'topic']).default('auto'),
  VECTOR_INDEX_PATH: z.string().default('./data/index.bin'),
  RANK_DEPTH: z.coerce.number().int().positive().default(200000),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`\nInvalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill it in.\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProd: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  /** The origin Discord serves an Activity from. */
  activityOrigin: `https://${raw.DISCORD_CLIENT_ID}.discordsays.com`,
};

export type Env = typeof env;
