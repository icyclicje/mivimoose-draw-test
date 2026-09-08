import { useEffect, useState } from 'react';
import { ModeIcon } from '../components/ModeIcon';
import { Section } from '../components/ui';
import { applyDensity, DENSITIES, loadDensity } from '../lib/density';
import { cx } from '../lib/format';
import { getSoundPrefs, play, setSoundPrefs, unlockAudio } from '../lib/sound';
import { applyTheme, loadTheme, THEMES } from '../lib/themes';

/**
 * Everything about how the game looks and sounds, in one place.
 *
 * The header keeps a one-click sound toggle because that is the control people
 * reach for mid-round. Themes and density live here instead: they are decisions
 * you make once, and a picker showing what each option actually looks like is
 * worth more than a button that cycles blindly through seven of them.
 */
export function Settings() {
  const [theme, setTheme] = useState(loadTheme);
  const [density, setDensity] = useState(loadDensity);
  const [sound, setSound] = useState(getSoundPrefs);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    applyDensity(density);
  }, [density]);

  const updateSound = (patch: Parameters<typeof setSoundPrefs>[0]) => {
    unlockAudio();
    setSound(setSoundPrefs(patch));
  };

  return (
    <div className="page page--narrow">
      <header className="col" style={{ gap: 'var(--s1)' }}>
        <h1>Settings</h1>
        <p className="dim thin" style={{ margin: 0 }}>
          Saved in this browser. They follow you between games, not between devices.
        </p>
      </header>

      {/* ---------------------------------------------------------- theme */}
      <Section title="Theme" action={<span className="faint thin">{THEMES.length} to choose from</span>}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
            gap: 'var(--s2)',
          }}
        >
          {THEMES.map((t) => {
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  play('click');
                  setTheme(t.id);
                }}
                aria-pressed={active}
                className="row"
                style={{
                  gap: 'var(--s2)',
                  padding: 'var(--s2)',
                  borderRadius: 'var(--r)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                  background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                  textAlign: 'left',
                }}
              >
                {/* The swatch is the point: the name of a theme tells you far
                    less than two of its colours side by side. */}
                <span
                  aria-hidden
                  style={{
                    width: 28,
                    height: 28,
                    flex: 'none',
                    borderRadius: 'var(--r-sm)',
                    background: t.swatch[0],
                    border: '1px solid var(--line-strong)',
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ position: 'absolute', inset: '50% 0 0 50%', background: t.swatch[1] }} />
                </span>
                <span className={cx('grow truncate', active && 'bold')} style={{ fontSize: 13.5 }}>
                  {t.name}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* -------------------------------------------------------- density */}
      <Section title="Layout">
        <div className="col" style={{ gap: 'var(--s2)' }}>
          {DENSITIES.map((d) => {
            const active = d.id === density;
            return (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  play('click');
                  setDensity(d.id);
                }}
                aria-pressed={active}
                className="row"
                style={{
                  gap: 'var(--s3)',
                  padding: 'var(--s3)',
                  borderRadius: 'var(--r)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                  background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                  textAlign: 'left',
                }}
              >
                <ModeIcon
                  name={d.icon}
                  size={20}
                  color={active ? 'var(--accent)' : 'var(--text-dim)'}
                />
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className={cx(active && 'bold')} style={{ fontSize: 14 }}>
                    {d.name}
                  </span>
                  <span className="faint thin" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
                    {d.description}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* ---------------------------------------------------------- sound */}
      <Section title="Sound">
        <div className="col" style={{ gap: 'var(--s3)' }}>
          <SoundRow
            label="Menu music"
            hint="A quiet bed in the menus, and a tighter one during a round."
            on={sound.music}
            onChange={(v) => updateSound({ music: v })}
          />
          <SoundRow
            label="Sound effects"
            hint="Guess feedback, round events, and the closer-you-get cue."
            on={sound.sfx}
            onChange={(v) => {
              updateSound({ sfx: v });
              if (v) play('click');
            }}
          />

          <label className="col" style={{ gap: 'var(--s1)' }}>
            <span className="row row--between" style={{ fontSize: 13 }}>
              <span>Volume</span>
              <span className="mono faint">{Math.round(sound.volume * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Volume"
              value={Math.round(sound.volume * 100)}
              onChange={(e) => updateSound({ volume: Number(e.target.value) / 100 })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </label>

          <p className="faint thin" style={{ margin: 0, fontSize: 12, lineHeight: 1.45 }}>
            Browsers keep audio silent until you interact with the page, so sound starts on your
            first click rather than when the game loads. You can add your own tracks by dropping
            files into the music folder; there is a README there explaining how.
          </p>
        </div>
      </Section>
    </div>
  );
}

function SoundRow({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="row"
      style={{ width: '100%', gap: 'var(--s3)', textAlign: 'left' }}
    >
      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14 }}>{label}</span>
        <span className="faint thin" style={{ fontSize: 12.5 }}>
          {hint}
        </span>
      </span>
      <span
        aria-hidden
        style={{
          width: 34,
          height: 20,
          flex: 'none',
          borderRadius: 'var(--r-pill)',
          padding: 2,
          background: on ? 'var(--accent)' : 'var(--surface-3)',
          transition: 'background 0.16s',
        }}
      >
        {/* The page ground, not white: on the light themes a white knob on a
            pale accent track disappears completely. */}
        <span
          style={{
            display: 'block',
            width: 16,
            height: 16,
            borderRadius: 'var(--r-pill)',
            background: on ? 'var(--bg)' : 'var(--text-dim)',
            marginLeft: on ? 14 : 0,
            transition: 'margin-left 0.16s, background 0.16s',
          }}
        />
      </span>
    </button>
  );
}
