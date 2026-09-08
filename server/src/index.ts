import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { corsDelegate } from './cors.js';
import { env } from './env.js';
import { log } from './log.js';
import { createApiRouter } from './routes.js';
import { createSocketServer } from './socket.js';
import { getLexicon } from './engine/lexicon.js';
import { rankerStats } from './engine/ranker.js';
import { prisma } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(cors(corsDelegate));
  app.use(express.json({ limit: '256kb' }));

  app.use('/api', createApiRouter());

  // In production the built client is served from the same origin, which keeps
  // the Discord Activity URL mapping to a single entry.
  const clientDist = path.resolve(here, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { maxAge: '1h', index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    log.info(`serving the client from ${clientDist}`);
  }

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('http: unhandled error', err);
    res.status(500).json({ error: 'Something went wrong' });
  });

  const server = http.createServer(app);
  const { manager } = createSocketServer(server);

  // Warm the semantic engine before accepting traffic so the first guess of the
  // first match is not the one that pays for building the index.
  const warmupStart = Date.now();
  getLexicon();
  log.ok(`engine ready in ${Date.now() - warmupStart}ms`, rankerStats());

  server.listen(env.PORT, () => {
    log.ok(`Mivimoose Guess server listening on http://localhost:${env.PORT}`);
    log.info(`activity origin: ${env.activityOrigin}`);
  });

  // Guest accounts are minted per sign-in, so a public deployment would grow a
  // row for every visitor forever. Prune the ones that never played and have
  // gone cold; anything with a match behind it is real history and stays.
  const pruneGuests = async () => {
    try {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const { count } = await prisma.user.deleteMany({
        where: { isGuest: true, matches: 0, lastSeenAt: { lt: cutoff } },
      });
      if (count > 0) log.info(`pruned ${count} stale guest accounts`);
    } catch (err) {
      log.error('guest prune failed', err);
    }
  };
  void pruneGuests();
  const pruneTimer = setInterval(() => void pruneGuests(), 6 * 60 * 60 * 1000);
  pruneTimer.unref();

  const shutdown = async (signal: string) => {
    log.warn(`${signal} received, shutting down`);
    for (const room of manager.all()) room.dispose();
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // A stray rejection somewhere should be loud, not fatal: a live match must
  // not end because one background write went wrong.
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', reason));
  process.on('uncaughtException', (err) => log.error('uncaught exception', err));
}

main().catch((err) => {
  log.error('fatal: server failed to start', err);
  process.exit(1);
});
