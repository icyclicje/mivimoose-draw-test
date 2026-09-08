import jwt from 'jsonwebtoken';
import type { Request, RequestHandler } from 'express';
import { env } from './env.js';
import { log } from './log.js';
import type { DiscordProfile } from './db.js';

const TOKEN_TTL = '7d';

export interface SessionClaims {
  sub: string; // internal user id
  did: string; // discord id
  gid?: string | null; // guild the activity was launched in
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, env.SESSION_SECRET, { expiresIn: TOKEN_TTL });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    return jwt.verify(token, env.SESSION_SECRET) as SessionClaims;
  } catch {
    return null;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionClaims;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const query = req.query.token;
  return typeof query === 'string' ? query : null;
}

export const requireAuth: RequestHandler = (req, res, next) => {
  const token = bearer(req);
  const claims = token ? verifySession(token) : null;
  if (!claims) {
    res.status(401).json({ error: 'Not authenticated' });
    return;
  }
  req.session = claims;
  next();
};

export const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = bearer(req);
  if (token) {
    const claims = verifySession(token);
    if (claims) req.session = claims;
  }
  next();
};

/* ------------------------------------------------------------------ *
 * Discord OAuth2
 * ------------------------------------------------------------------ */

export interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

/**
 * Exchange the authorization code the embedded SDK hands us for an access
 * token. This must happen server side — the client secret never leaves here.
 */
export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
  });

  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    log.error(`discord: token exchange failed (${res.status}) ${text}`);
    throw new Error('Discord rejected the authorization code');
  }
  return (await res.json()) as DiscordTokenResponse;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordProfile> {
  const res = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Could not read the Discord profile');
  return (await res.json()) as DiscordProfile;
}
