/**
 * How tightly the game packs itself in.
 *
 * Like themes, this is one attribute on <html> and a handful of CSS overrides,
 * not a prop threaded through every component. That keeps it impossible for a
 * screen to be built at one density and rendered at another, and it means the
 * setting costs a repaint rather than a re-render.
 */

export interface DensityDef {
  id: string;
  name: string;
  description: string;
  icon: string;
}

export const DENSITIES: DensityDef[] = [
  {
    id: 'condensed',
    name: 'Condensed',
    description: 'Tighter rows and spacing, so more of the board fits without scrolling.',
    icon: 'rowsTight',
  },
  {
    id: 'expanded',
    name: 'Expanded',
    description: 'Roomier rows and more breathing space. Easier to read, fewer rows on screen.',
    icon: 'rows',
  },
];

const STORAGE_KEY = 'mivimoose:density';

/** Condensed by default: the board is the thing you read most, and more of it
 *  on screen at once is worth more than the extra few pixels per row. */
const DEFAULT_DENSITY = 'condensed';

export function loadDensity(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DENSITIES.some((d) => d.id === saved)) return saved;
  } catch {
    // Private browsing and embedded contexts can both refuse storage.
  }
  return DEFAULT_DENSITY;
}

export function applyDensity(id: string): void {
  document.documentElement.dataset.density = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not being able to remember the choice is no reason to refuse it.
  }
}

export function densityMeta(id: string): DensityDef {
  return DENSITIES.find((d) => d.id === id) ?? DENSITIES[0];
}
