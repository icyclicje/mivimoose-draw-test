import { useEffect, useState } from 'react';
import { applyTheme, loadTheme, nextTheme, THEMES, themeMeta } from '../lib/themes';

/**
 * Cycles themes on click. The button shows the theme you'd get next rather than
 * the one you're on, so a click is predictable before you make it.
 *
 * Right-click (or a long press) opens the full list, because cycling seven
 * themes to reach the one you want gets old fast.
 */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState(loadTheme);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  const upcoming = themeMeta(nextTheme(theme));

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        className="btn btn--ghost btn--sm"
        style={{ padding: '0 var(--s2)', gap: 'var(--s2)' }}
        title={`Theme: ${themeMeta(theme).name} — click for ${upcoming.name}, right-click for all`}
        aria-label={`Change theme. Currently ${themeMeta(theme).name}.`}
        onClick={() => setTheme((t) => nextTheme(t))}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Swatch theme={upcoming.swatch} />
      </button>

      {open && (
        <div
          className="panel"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 70,
            padding: 'var(--s1)',
            minWidth: 148,
          }}
        >
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="row"
              onClick={() => {
                setTheme(t.id);
                setOpen(false);
              }}
              style={{
                width: '100%',
                gap: 'var(--s2)',
                padding: '6px var(--s2)',
                borderRadius: 'var(--r-sm)',
                background: t.id === theme ? 'var(--surface-2)' : 'transparent',
                fontWeight: t.id === theme ? 'var(--w-bold)' : 'var(--w-normal)',
                fontSize: 13,
              }}
            >
              <Swatch theme={t.swatch} />
              <span className="grow" style={{ textAlign: 'left' }}>
                {t.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Swatch({ theme }: { theme: [string, string] }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 18,
        height: 18,
        flex: 'none',
        borderRadius: 'var(--r-sm)',
        background: theme[0],
        border: '1px solid var(--line-strong)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <span
        style={{
          position: 'absolute',
          inset: '50% 0 0 50%',
          background: theme[1],
        }}
      />
    </span>
  );
}
