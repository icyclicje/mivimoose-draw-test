import { useEffect, useRef, useState } from 'react';
import { getSoundPrefs, play, setSoundPrefs, unlockAudio } from '../lib/sound';
import { ModeIcon } from './ModeIcon';

/**
 * Sound control for the header.
 *
 * Left-click opens the panel: music, effects, volume. It used to sit behind a
 * right-click, which meant nobody found it; now that music plays by default,
 * the control people reach for first is the one that turns it off, so it has to
 * be one ordinary click away. Right-click still opens it for anyone who learnt
 * the old gesture.
 *
 * The icon reports what is on rather than what a click would do: music, effects
 * only, or silence.
 *
 * Every interaction here also unlocks the AudioContext, which browsers refuse
 * to start without a gesture.
 */
export function SoundToggle() {
  const [prefs, setPrefs] = useState(getSoundPrefs);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    // Containment check rather than "any pointerdown closes it" because the
    // volume slider lives inside the panel: a drag starts with a pointerdown,
    // and a blind close would tear the panel out from under the thumb on the
    // first pixel of every drag.
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      // Only reclaim focus if it was inside the panel we just removed. This is
      // a window listener, so an unconditional focus() would yank focus off
      // whatever a keyboard user had already tabbed on to.
      if (rootRef.current?.contains(document.activeElement)) buttonRef.current?.focus();
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // sound.ts keeps its prefs interface private, so the patch type is read back
  // off the setter rather than duplicated here and left to drift.
  const update = (patch: Parameters<typeof setSoundPrefs>[0]) => {
    unlockAudio();
    setPrefs(setSoundPrefs(patch));
  };

  const summary = prefs.music
    ? prefs.sfx
      ? 'Music and effects on'
      : 'Music on, effects off'
    : prefs.sfx
      ? 'Music off, effects on'
      : 'Everything muted';

  // 'spark' is the small blip glyph, meaning effects without the music. The icon set
  // has nothing better for "half on", and a music note here would be a lie.
  const icon = prefs.music ? 'music' : prefs.sfx ? 'spark' : 'mute';
  const silent = !prefs.music && !prefs.sfx;

  return (
    <div ref={rootRef} style={{ position: 'relative', flex: 'none' }}>
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--ghost btn--sm"
        style={{ padding: '0 var(--s2)', color: silent ? 'var(--text-faint)' : undefined }}
        title={`${summary}. Click for sound settings.`}
        aria-label={`Sound settings. ${summary}.`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          unlockAudio();
          setOpen((v) => !v);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          unlockAudio();
          setOpen((v) => !v);
        }}
      >
        <ModeIcon name={icon} size={15} />
      </button>

      {open && (
        <div
          className="panel"
          role="dialog"
          aria-label="Sound settings"
          style={{
            position: 'absolute',
            top: 'calc(100% + var(--s1))',
            right: 0,
            zIndex: 70,
            padding: 'var(--s3)',
            width: 216,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s3)',
          }}
        >
          {/* Music first: it is the loudest thing on by default, so it is the
              one most people open this panel to change. */}
          <Row label="Menu music" on={prefs.music} onChange={(v) => update({ music: v })} />
          <Row
            label="Sound effects"
            on={prefs.sfx}
            onChange={(v) => {
              update({ sfx: v });
              // Only makes sense to confirm the change you can now hear.
              if (v) play('click');
            }}
          />

          <label className="col" style={{ gap: 'var(--s1)' }}>
            <span className="row row--between faint" style={{ fontSize: 12 }}>
              <span>Volume</span>
              <span className="mono">{Math.round(prefs.volume * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              // Named explicitly: otherwise the label's own text is the
              // accessible name, and the live percentage inside it would be
              // read back as part of that name on every step of a drag.
              aria-label="Volume"
              value={Math.round(prefs.volume * 100)}
              onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          </label>

          {/* Explains silence on a fresh load. Deliberately not phrased as
              "music starts once you click something": the panel can only be
              reached by clicking, so that tense is already false by the time
              anyone reads it, and the gesture gate holds back effects too, not
              just music. */}
          <p
            className="faint"
            style={{
              margin: 0,
              fontSize: 11,
              lineHeight: 1.4,
              borderTop: '1px solid var(--line)',
              paddingTop: 'var(--s2)',
            }}
          >
            Browsers keep audio silent until you interact with the page, so sound starts on your
            first click rather than when the game loads.
          </p>
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
      role="switch"
      aria-checked={on}
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
        {/* The knob has to read against two different grounds, and --text only
            clears one of them. On the accent track --text lands at 1.1:1 in
            mono and 1.4:1 in neon, so the knob disappears and the switch stops
            showing its state at all. --bg is the token that is always the far
            side of --accent (3.7:1 at worst across the seven themes), and
            --text-dim clears the surface-3 track by 4:1 at worst while staying
            visibly quieter than the on state. */}
        <span
          style={{
            display: 'block',
            width: 14,
            height: 14,
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
