/**
 * Themes are a single attribute on <html>. Each entry in themes.css redefines
 * the same colour tokens, so switching one is a repaint and nothing more.
 */

export interface ThemeDef {
  id: string;
  name: string;
  /** Two swatches for the switcher: ground and accent. */
  swatch: [string, string];
}

export const THEMES: ThemeDef[] = [
  { id: 'midnight', name: 'Midnight', swatch: ['#0f172a', '#009afe'] },
  { id: 'daylight', name: 'Daylight', swatch: ['#f5f7fa', '#0084dc'] },
  { id: 'ember', name: 'Ember', swatch: ['#17120c', '#ffb020'] },
  { id: 'moss', name: 'Moss', swatch: ['#0c1512', '#2fbf8f'] },
  { id: 'paper', name: 'Paper', swatch: ['#f6f1e7', '#b06a1f'] },
  { id: 'neon', name: 'Neon', swatch: ['#0a0714', '#00e5ff'] },
  { id: 'mono', name: 'Mono', swatch: ['#101012', '#e6e6e8'] },
];

const STORAGE_KEY = 'mivimoose:theme';

export function loadTheme(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((t) => t.id === saved)) return saved;
  } catch {
    // Private browsing and embedded contexts can both refuse storage.
  }
  return THEMES[0].id;
}

export function applyTheme(id: string): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not being able to remember the choice is not a reason to refuse it.
  }
}

export function nextTheme(current: string): string {
  const i = THEMES.findIndex((t) => t.id === current);
  return THEMES[(i + 1) % THEMES.length].id;
}

export function themeMeta(id: string): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}
