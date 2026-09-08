import type {
  DailyChallengeState,
  GameSettings,
  GuessResult,
  LeaderboardRow,
  ProfileStats,
} from '@mivimoose/shared';
import { API_BASE } from './discord';

let authToken: string | null = null;

export function setApiToken(token: string | null) {
  authToken = token;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      (body as { error?: string }).error ?? `Request failed (${res.status})`,
      res.status,
      (body as { code?: string }).code,
    );
  }
  return body as T;
}

export interface PresetSummary {
  id: string;
  name: string;
  shareCode: string;
  settings: GameSettings;
  uses?: number;
  isPublic?: boolean;
  author?: string;
}

export const api = {
  me: () => request<{ id: string; displayName: string }>('/me'),

  leaderboard: (params: {
    metric: string;
    scope?: string;
    mode?: string;
    guildId?: string | null;
    limit?: number;
  }) => {
    const search = new URLSearchParams();
    search.set('metric', params.metric);
    if (params.scope) search.set('scope', params.scope);
    if (params.mode) search.set('mode', params.mode);
    if (params.guildId) search.set('guildId', params.guildId);
    if (params.limit) search.set('limit', String(params.limit));
    return request<{ metric: string; rows: LeaderboardRow[] }>(`/leaderboard?${search}`);
  },

  profile: (userId?: string) => request<ProfileStats>(`/profile${userId ? `/${userId}` : ''}`),

  daily: () => request<DailyChallengeState>('/daily'),

  dailyGuess: (word: string) =>
    request<{ result: GuessResult; state: DailyChallengeState }>('/daily/guess', {
      method: 'POST',
      body: JSON.stringify({ word }),
    }),

  dailyLeaderboard: (date?: string) =>
    request<{ date: string; rows: LeaderboardRow[] }>(
      `/daily/leaderboard${date ? `?date=${date}` : ''}`,
    ),

  presets: () => request<{ mine: PresetSummary[]; featured: PresetSummary[] }>('/presets'),

  savePreset: (name: string, settings: GameSettings, isPublic = false) =>
    request<PresetSummary>('/presets', {
      method: 'POST',
      body: JSON.stringify({ name, settings, isPublic }),
    }),

  loadPreset: (shareCode: string) => request<PresetSummary>(`/presets/${shareCode}`),

  deletePreset: (id: string) => request<void>(`/presets/${id}`, { method: 'DELETE' }),

  validateWords: (words: string[]) =>
    request<{
      words: { input: string; ok: boolean; word: string | null; note: string | null }[];
      usable: string[];
    }>('/words/validate', { method: 'POST', body: JSON.stringify({ words }) }),
};
