import type { CorsOptionsDelegate, CorsRequest } from 'cors';
import { env } from './env.js';
import { log } from './log.js';

/**
 * The hostname a request actually arrived on. Behind a proxy (Railway, and any
 * other PaaS) the public hostname is in x-forwarded-host and `host` is the
 * internal one, so the forwarded value wins when it is there.
 */
function requestHost(req: CorsRequest): string | undefined {
  const forwarded = req.headers['x-forwarded-host'];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host;
  return raw?.split(',')[0]?.trim();
}

export function isOriginAllowed(origin: string, host?: string): boolean {
  // Browsers send an Origin header on a same-origin POST, so a plain browser
  // tab on the deployment's own domain lands here and has to be let through
  // without anyone having to list that domain in CORS_ORIGINS.
  if (host && origin.replace(/^https?:\/\//, '') === host) return true;
  return (
    env.corsOrigins.includes(origin) ||
    origin === env.activityOrigin ||
    /^https:\/\/[\w-]+\.discordsays\.com$/.test(origin) ||
    (!env.isProd && /^http:\/\/localhost:\d+$/.test(origin))
  );
}

/**
 * Shared by the HTTP app and the socket server so both answer the same way.
 * A blocked origin gets a response without CORS headers — which is what the
 * browser needs to see — rather than a 500 from the error handler.
 */
export const corsDelegate: CorsOptionsDelegate<CorsRequest> = (req, callback) => {
  const origin = req.headers.origin;
  // Same-origin GETs and server-to-server requests have no Origin header.
  if (!origin) return callback(null, { origin: true, credentials: true });

  const allowed = isOriginAllowed(origin, requestHost(req));
  if (!allowed) log.warn(`cors: blocked origin ${origin}`);
  callback(null, { origin: allowed, credentials: true });
};
