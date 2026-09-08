import type { Difficulty, GameMode, GameSettings, ModeDescriptor } from './types.js';
import { CATEGORIES, DIFFICULTIES, GAME_MODES, VISIBILITY } from './types.js';

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'classic',
  roundSeconds: 180,
  rounds: 3,
  maxPlayers: 10,
  // Everyday words by default. A multiplayer round is only fun when everyone
  // has a route in; obscure answers are opt-in through the difficulty setting.
  difficulty: 'easy',
  category: 'any',
  guessLimit: 0,
  hints: 1,
  visibility: 'best',
  endOnFirstFind: false,
  ranked: false,
  allowSpectators: true,
  private: false,
  chatEnabled: true,
  emotesEnabled: true,
  strikes: 3,
  teamGuessBudget: 40,
  coldPenaltySeconds: 0,
  customWords: null,
  seed: null,
};

export const MODES: Record<GameMode, ModeDescriptor> = {
  classic: {
    id: 'classic',
    name: 'Classic Race',
    tagline: 'Up to 10 players, one word, first to crack it',
    description:
      'Everybody hunts the same secret word at the same time. Find it first for the win; when the clock runs out the closest rank takes the round.',
    minPlayers: 1,
    maxPlayers: 10,
    icon: 'flag',
    accent: '#7c8cff',
    locked: [],
    defaults: { rounds: 3, roundSeconds: 180, maxPlayers: 10, visibility: 'best' },
  },
  duel: {
    id: 'duel',
    name: 'Duel',
    tagline: 'Head to head, rated, best of three',
    description:
      'One on one, and the boards stay private. A word your opponent has already burned is simply closed to you — you learn that it is taken and nothing else. Moves your Elo.',
    minPlayers: 2,
    maxPlayers: 2,
    icon: 'swords',
    accent: '#ff6b6b',
    locked: ['maxPlayers'],
    defaults: {
      rounds: 3,
      roundSeconds: 150,
      maxPlayers: 2,
      ranked: true,
      visibility: 'full',
      endOnFirstFind: true,
    },
  },
  blitz: {
    id: 'blitz',
    name: 'Blitz',
    tagline: 'Sixty seconds a word, five words, no mercy',
    description:
      'Short fuses and fast points. You are scored on how close you land before the buzzer, so a decent rank beats a perfect answer you never reach.',
    minPlayers: 1,
    maxPlayers: 10,
    icon: 'bolt',
    accent: '#ffd166',
    locked: [],
    defaults: { rounds: 5, roundSeconds: 60, hints: 0, endOnFirstFind: false, visibility: 'count' },
  },
  elimination: {
    id: 'elimination',
    name: 'Elimination',
    tagline: 'Coldest guess goes home each round',
    description:
      'Every round the player sitting furthest from the word is knocked out. Survive to the end. Ties break on guess count, then on speed.',
    minPlayers: 3,
    maxPlayers: 10,
    icon: 'skull',
    accent: '#c084fc',
    locked: ['rounds'],
    defaults: { rounds: 9, roundSeconds: 120, visibility: 'best', hints: 1 },
  },
  marathon: {
    id: 'marathon',
    name: 'Marathon',
    tagline: 'Ten words, one running score',
    description:
      'A long haul across ten secret words with points stacking the whole way. Consistency wins here; one lucky round will not carry you.',
    minPlayers: 1,
    maxPlayers: 10,
    icon: 'route',
    accent: '#34d399',
    locked: [],
    defaults: { rounds: 10, roundSeconds: 100, hints: 3, visibility: 'best' },
  },
  coop: {
    id: 'coop',
    name: 'Co-op',
    tagline: 'One team, one shared guess budget',
    description:
      'Everybody hunts the same word out of one shared pool of guesses. Boards stay private even here, so a word a teammate has already spent comes back closed — it costs the team nothing, but nobody gets to ride along on the reads somebody else paid for.',
    minPlayers: 2,
    maxPlayers: 10,
    icon: 'users',
    accent: '#38bdf8',
    locked: ['ranked'],
    defaults: {
      rounds: 3,
      roundSeconds: 240,
      visibility: 'full',
      ranked: false,
      teamGuessBudget: 40,
      endOnFirstFind: true,
    },
  },
  suddenDeath: {
    id: 'suddenDeath',
    name: 'Sudden Death',
    tagline: 'One guess per turn, three strikes',
    description:
      'Turn based. Each guess must beat the best rank on the board or you take a strike. Three strikes and you are out of the round.',
    minPlayers: 2,
    maxPlayers: 8,
    icon: 'target',
    accent: '#fb7185',
    locked: ['guessLimit'],
    defaults: {
      rounds: 3,
      roundSeconds: 20,
      strikes: 3,
      hints: 0,
      visibility: 'full',
      guessLimit: 0,
    },
  },
  daily: {
    id: 'daily',
    name: 'Daily',
    tagline: 'One word a day, the whole server against it',
    description:
      'The same secret word for everyone, everywhere, until midnight UTC. Unlimited guesses, and the leaderboard sorts by how few you needed.',
    minPlayers: 1,
    maxPlayers: 10,
    icon: 'calendar',
    accent: '#f59e0b',
    locked: ['rounds', 'roundSeconds', 'difficulty', 'ranked'],
    defaults: {
      rounds: 1,
      roundSeconds: 0,
      difficulty: 'normal',
      ranked: false,
      hints: 0,
      visibility: 'count',
    },
  },
};

export const MODE_LIST: ModeDescriptor[] = GAME_MODES.map((m) => MODES[m]);

/** Secret-word frequency band per difficulty: the slice of the ranked lexicon we pull from. */
export const DIFFICULTY_BANDS: Record<Difficulty, { from: number; to: number; label: string }> = {
  easy: { from: 0, to: 0.12, label: 'Everyday words' },
  normal: { from: 0.05, to: 0.35, label: 'Common vocabulary' },
  hard: { from: 0.25, to: 0.7, label: 'Uncommon words' },
  insane: { from: 0.55, to: 1, label: 'Deep cuts' },
};

export function defaultsForMode(mode: GameMode): GameSettings {
  return { ...DEFAULT_SETTINGS, ...MODES[mode].defaults, mode };
}

const NUMERIC_BOUNDS: Partial<Record<keyof GameSettings, [number, number]>> = {
  roundSeconds: [0, 900],
  rounds: [1, 20],
  maxPlayers: [1, 10],
  guessLimit: [0, 200],
  hints: [0, 5],
  strikes: [1, 5],
  teamGuessBudget: [5, 300],
  coldPenaltySeconds: [0, 30],
};

/** Assign through a loosened view; the callers below have already validated. */
function put(target: GameSettings, key: keyof GameSettings, value: unknown): void {
  (target as unknown as Record<string, unknown>)[key] = value;
}

function clampNumber(key: keyof GameSettings, value: number): number {
  const bounds = NUMERIC_BOUNDS[key];
  if (!bounds) return value;
  const n = Math.round(Number.isFinite(value) ? value : 0);
  return Math.min(bounds[1], Math.max(bounds[0], n));
}

/**
 * Merge a host-supplied patch onto a base settings object, dropping anything
 * the mode locks and clamping everything else into range. The server treats
 * this as the single source of truth so a hand-crafted socket payload cannot
 * produce a 900-player room.
 */
export function sanitizeSettings(
  patch: Partial<GameSettings>,
  base: GameSettings = DEFAULT_SETTINGS,
): GameSettings {
  const mode: GameMode = GAME_MODES.includes(patch.mode as GameMode)
    ? (patch.mode as GameMode)
    : base.mode;

  // Switching modes rebases onto that mode's defaults rather than the old room.
  const start: GameSettings = mode !== base.mode ? defaultsForMode(mode) : { ...base };
  const descriptor = MODES[mode];
  const out: GameSettings = { ...start, mode };

  for (const [rawKey, rawValue] of Object.entries(patch)) {
    const key = rawKey as keyof GameSettings;
    if (key === 'mode') continue;
    if (rawValue === undefined) continue;
    if (descriptor.locked.includes(key)) continue;

    switch (key) {
      case 'difficulty':
        if (DIFFICULTIES.includes(rawValue as Difficulty)) out.difficulty = rawValue as Difficulty;
        break;
      case 'category':
        if (CATEGORIES.includes(rawValue as never)) out.category = rawValue as never;
        break;
      case 'visibility':
        if (VISIBILITY.includes(rawValue as never)) out.visibility = rawValue as never;
        break;
      case 'customWords': {
        if (rawValue === null) {
          out.customWords = null;
        } else if (Array.isArray(rawValue)) {
          const words = rawValue
            .filter((w): w is string => typeof w === 'string')
            .map((w) => w.trim().toLowerCase())
            .filter((w) => /^[a-z][a-z'-]{1,23}$/.test(w))
            .slice(0, 100);
          out.customWords = words.length ? Array.from(new Set(words)) : null;
        }
        break;
      }
      case 'seed':
        out.seed =
          typeof rawValue === 'string' && rawValue.length ? rawValue.slice(0, 40) : null;
        break;
      default: {
        if (typeof rawValue === 'boolean') put(out, key, rawValue);
        else if (typeof rawValue === 'number') put(out, key, clampNumber(key, rawValue));
      }
    }
  }

  // Mode-locked fields always win.
  Object.assign(out, descriptor.defaults, { mode });
  for (const key of Object.keys(descriptor.defaults) as (keyof GameSettings)[]) {
    if (!descriptor.locked.includes(key) && patch[key] !== undefined) {
      const supplied = patch[key];
      if (typeof supplied === 'number') put(out, key, clampNumber(key, supplied));
      else if (typeof supplied === 'boolean' || typeof supplied === 'string') put(out, key, supplied);
    }
  }

  out.maxPlayers = Math.min(descriptor.maxPlayers, Math.max(descriptor.minPlayers, out.maxPlayers));
  if (out.customWords) out.rounds = Math.min(out.rounds, out.customWords.length);
  // Only the head-to-head ladders touch Elo; everything else is unranked.
  if (!modeSupportsRanked(mode)) out.ranked = false;
  return out;
}

export function modeSupportsRanked(mode: GameMode): boolean {
  return mode === 'duel' || mode === 'classic';
}

export function isTurnBased(mode: GameMode): boolean {
  return mode === 'suddenDeath';
}

export function isTeamMode(mode: GameMode): boolean {
  return mode === 'coop';
}
