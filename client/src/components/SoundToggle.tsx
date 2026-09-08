import { useEffect, useState } from 'react';
import { getSoundPrefs, play, setSoundPrefs, unlockAudio } from '../lib/sound';
import { ModeIcon } from './ModeIcon';

/**
 * Sound control for the header.
 *
 * Click toggles effects, right-click opens the full panel with music and
 * volume. Music is OFF by default and effects ON: a game that starts playing
 * a loop at you unannounced is the fastest way to get muted at the OS level,
 * but silence on every click feels broken.
 *
 * The first interaction here also unlocks the AudioContext, which browsers
 * refuse to start without a gesture.
 */
export function SoundToggle() {
  const [prefs, setPrefs] = useState(getSoundPrefs);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [open]);

  const update = (patch: Parameters<typeof setSoundPrefs>[0]) => {
    unlockAudio();
    setPrefs(setSoundPrefs(patch));
  };

  return (
    <div style={{ position: 'relative', flex: 'none' }}>
      <button
        className="btn btn--ghost btn--sm"
        style={{ padding: '0 var(--s2)' }}
        title={`Sound ${prefs.sfx ? 'on' : 'off'} — right-click for music and volume`}
        aria-label={prefs.sfx ? 'Mute sound effects' : 'Unmute sound effects'}
        onClick={() => {
          const next = !prefs.sfx;
          update({ sfx: next });
          // Only makes sense to confirm the change you can now hear.
          if (next) play('click');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          unlockAudio();
          setOpen((v) => !v);
        }}
      >
        <ModeIcon name={prefs.sfx ? 'music' : 'mute'} size={15} />
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
            padding: 'var(--s3)',
            width: 200,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s3)',
          }}
        >
          <Row
            label="Sound effects"
            on={prefs.sfx}
            onChange={(v) => {
              update({ sfx: v });
              if (v) play('click');
            }}
          />
          <Row label="Menu music" on={prefs.music} onChange={(v) => update({ music: v })} />

          <label className="col" style={{ gap: 'var(--s1)' }}>
            <span className="faint" style={{ fontSize: 12 }}>
              Volume
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(prefs.volume * 100)}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="row"
      onClick={() => onChange(!on)}
      style={{ width: '100%', gap: 'var(--s2)', fontSize: 13 }}
    >
      <span className="grow" style={{ textAlign: 'left' }}>
        {label}
      </span>
      <span
        aria-hidden
        style={{
          width: 32,
          height: 18,
          flex: 'none',
          borderRadius: 'var(--r-pill)',
          padding: 2,
          background: on ? 'var(--accent)' : 'var(--surface-3)',
          transition: 'background 0.16s',
        }}
      >
        <span
          style={{
            display: 'block',
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: 'var(--text)',
            marginLeft: on ? 14 : 0,
            transition: 'margin-left 0.16s',
          }}
        />
      </span>
    </button>
  );
}
