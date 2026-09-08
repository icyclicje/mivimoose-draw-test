/**
 * Guarantees a DATABASE_URL exists before anything Prisma-shaped runs.
 *
 * This is separate from src/env.ts on purpose. The Prisma CLI (`generate`,
 * `db push`) and the generated client both read `process.env.DATABASE_URL`
 * directly, because that is what `env("DATABASE_URL")` in schema.prisma means.
 * A default living inside our own zod schema is invisible to them, so on a
 * deployment with no variables set at all, `prisma db push` fails schema
 * validation and the container dies before the server ever boots.
 *
 * Run as a script it writes `prisma/.env`, which the Prisma CLI picks up
 * automatically on later, separate invocations. Imported, it also sets the
 * variable on the current process. Dotenv never overwrites an existing value,
 * so a real DATABASE_URL from the host always wins.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

/** Where the SQLite file should live when nobody has said. */
export function defaultDatabaseUrl() {
  // A Railway volume is the only directory that outlives a redeploy, so prefer
  // it. Without one, keep it beside the other generated data.
  const volume = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  const dir = volume ? path.join(volume, 'db') : path.join(serverRoot, 'data');
  fs.mkdirSync(dir, { recursive: true });
  // Prisma wants a URL; forward slashes so a Windows path stays parseable.
  return `file:${path.join(dir, 'arena.db').split(path.sep).join('/')}`;
}

/**
 * Returns the effective URL, sets it on this process, and persists it to
 * prisma/.env for the CLI. Safe to call repeatedly.
 */
export function ensureDatabaseUrl({ quiet = false } = {}) {
  const existing = process.env.DATABASE_URL?.trim();
  if (existing) return existing;

  const url = defaultDatabaseUrl();
  process.env.DATABASE_URL = url;

  const envFile = path.join(serverRoot, 'prisma', '.env');
  try {
    fs.mkdirSync(path.dirname(envFile), { recursive: true });
    fs.writeFileSync(envFile, `DATABASE_URL="${url}"\n`);
  } catch {
    // A read-only filesystem still leaves process.env set for this process,
    // which covers the server itself even if the CLI has to be told again.
  }

  if (!quiet) {
    console.log(`[database] DATABASE_URL not set — defaulting to ${url}`);
  }
  return url;
}

// Running it directly is what the build and start scripts do.
if (import.meta.url === `file://${process.argv[1]?.split(path.sep).join('/')}`) {
  ensureDatabaseUrl();
}
