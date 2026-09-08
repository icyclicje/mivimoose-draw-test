import { DiscordSDK } from '@discord/embedded-app-sdk';
import type { PublicUser } from '@mivimoose/shared';

/**
 * Discord serves an Activity inside a sandboxed iframe on
 * `<app-id>.discordsays.com` and every network call has to leave through the
 * `/.proxy` prefix. Detecting that up front lets the rest of the app use one
 * base path and stay identical in a normal browser tab.
 */
export const isEmbedded = new URLSearchParams(window.location.search).has('frame_id');

export const API_BASE = isEmbedded ? '/.proxy/api' : '/api';
export const SOCKET_PATH = isEmbedded ? '/.proxy/socket.io' : '/socket.io';

const CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

export interface DiscordContext {
  token: string;
  user: PublicUser;
  instanceId: string | null;
  guildId: string | null;
  channelId: string | null;
}

let sdk: DiscordSDK | null = null;

export function getSdk(): DiscordSDK | null {
  return sdk;
}

/**
 * The full Activity handshake:
 *   ready -> authorize (gets an OAuth code) -> our server swaps it for a token
 *   -> authenticate (hands the access token back to the SDK so RPC works).
 */
export async function connectDiscord(): Promise<DiscordContext> {
  if (!CLIENT_ID) {
    throw new Error('VITE_DISCORD_CLIENT_ID is not set. Copy .env.example to .env.');
  }

  sdk = new DiscordSDK(CLIENT_ID);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: CLIENT_ID,
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds'],
  });

  const res = await fetch(`${API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, guildId: sdk.guildId, channelId: sdk.channelId }),
  });
  if (!res.ok) throw new Error('The server could not verify your Discord login');

  const payload = (await res.json()) as { access_token: string; token: string; user: PublicUser };

  // Completes the SDK's own auth so commands like setActivity are permitted.
  await sdk.commands.authenticate({ access_token: payload.access_token });

  return {
    token: payload.token,
    user: payload.user,
    instanceId: sdk.instanceId ?? null,
    guildId: sdk.guildId ?? null,
    channelId: sdk.channelId ?? null,
  };
}

/**
 * Guest sign-in. Works anywhere, including production, so the game can be
 * played and tested in a plain browser tab. Every call mints a fresh throwaway
 * account, which means a second tab is a second player you can face online.
 */
export async function guestLogin(name?: string): Promise<DiscordContext> {
  const res = await fetch(`${API_BASE}/guest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name?.trim() || undefined }),
  });
  if (!res.ok) throw new Error('Could not start a guest session');
  const payload = (await res.json()) as { token: string; user: PublicUser };
  return { ...payload, instanceId: null, guildId: null, channelId: null };
}

/** Shows what the player is up to on their Discord profile. */
export async function setActivity(details: string, state: string) {
  if (!sdk) return;
  try {
    await sdk.commands.setActivity({
      activity: {
        type: 0,
        details: details.slice(0, 128),
        state: state.slice(0, 128),
        timestamps: { start: Date.now() },
      },
    });
  } catch {
    // Presence is a nicety; never let it break a match.
  }
}
