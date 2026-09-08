import { bandMeta, type RankBand } from '@mivimoose/shared';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function bandColor(band: RankBand): string {
  return bandMeta(band).color;
}

export function bandLabel(band: RankBand): string {
  return bandMeta(band).label;
}

export function formatRank(rank: number | null | undefined): string {
  if (rank === null || rank === undefined) return '—';
  return rank.toLocaleString();
}

/** mm:ss for anything under an hour, which every round is. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

const MODE_LABEL: Record<string, string> = {
  classic: 'Classic',
  duel: 'Duel',
  blitz: 'Blitz',
  elimination: 'Elimination',
  marathon: 'Marathon',
  coop: 'Co-op',
  suddenDeath: 'Sudden Death',
  daily: 'Daily',
};

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode;
}
