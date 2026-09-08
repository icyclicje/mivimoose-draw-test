import { useState, type ReactNode } from 'react';
import {
  CATEGORIES,
  DIFFICULTIES,
  DIFFICULTY_BANDS,
  MODE_LIST,
  MODES,
  VISIBILITY,
  type Category,
  type Difficulty,
  type GameSettings,
  type Visibility,
} from '@mivimoose/shared';
import { api } from '../lib/api';
import { formatClock } from '../lib/format';
import { useStore } from '../lib/store';
import { Field, Segmented, Stepper, Toggle } from './ui';
import { ModeIcon } from './ModeIcon';

/** The server clamps rounds to this however long a custom word list is. */
const MAX_ROUNDS = 20;

const VISIBILITY_HINT: Record<Visibility, string> = {
  hidden: 'nothing about opponents',
  count: 'their guess count only',
  best: 'their closest rank',
  full: 'their rank on every guess',
};

/** A titled run of fields. No border — the editor already sits inside a panel. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="col" style={{ gap: 'var(--s2)' }}>
      <div className="eyebrow">{title}</div>
      {children}
    </section>
  );
}

/** Mode blurbs in shared/ run a full paragraph; only the opening line fits here. */
function firstSentence(text: string): string {
  const stop = text.indexOf('. ');
  return stop === -1 ? text : text.slice(0, stop + 1);
}

/**
 * The full custom-game editor. Anything the chosen mode locks is rendered
 * disabled rather than hidden, so hosts can see why a knob will not move.
 * The knobs almost nobody touches sit behind Advanced so the default view
 * fits on one screen.
 */
export function SettingsEditor({
  settings,
  onChange,
  disabled,
  showModePicker = true,
}: {
  settings: GameSettings;
  onChange: (patch: Partial<GameSettings>) => void;
  disabled?: boolean;
  showModePicker?: boolean;
}) {
  const toast = useStore((s) => s.toast);
  const descriptor = MODES[settings.mode];
  const locked = (key: keyof GameSettings) => disabled || descriptor.locked.includes(key);

  const wordsFromSettings = settings.customWords?.join(', ') ?? '';
  const [wordDraft, setWordDraft] = useState(wordsFromSettings);
  const [syncedWords, setSyncedWords] = useState(wordsFromSettings);
  const [checking, setChecking] = useState(false);
  // Open Advanced on arrival if any of it is already set, so a host never
  // misses a custom list or a seed someone else left behind.
  const [advanced, setAdvanced] = useState(
    Boolean(settings.customWords || settings.seed || settings.coldPenaltySeconds),
  );

  // The list can change under us: a preset load on Home, another host's edit
  // arriving over the socket in the lobby. Re-seed the box when it does, and
  // compare by value so a resend of the same words never eats what someone is
  // half way through typing.
  if (wordsFromSettings !== syncedWords) {
    setSyncedWords(wordsFromSettings);
    setWordDraft(wordsFromSettings);
    if (wordsFromSettings) setAdvanced(true);
  }

  async function applyCustomWords() {
    const words = wordDraft
      .split(/[\s,\n]+/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    if (!words.length) {
      onChange({ customWords: null });
      toast('info', 'Word list cleared, back to the random pool');
      return;
    }

    setChecking(true);
    try {
      const { words: checked, usable } = await api.validateWords(words);
      const rejected = checked.filter((c) => !c.ok).map((c) => c.input);
      if (!usable.length) {
        toast('error', 'None of those words are in the lexicon');
        return;
      }
      onChange({ customWords: usable, rounds: Math.min(settings.rounds, usable.length) });
      // Rewrite the box here too: when only rejects were dropped the settings
      // value can come back unchanged, and then the sync above never fires.
      setWordDraft(usable.join(', '));
      toast(
        rejected.length ? 'warn' : 'success',
        rejected.length
          ? `${usable.length} words in, dropped: ${rejected.slice(0, 4).join(', ')}${rejected.length > 4 ? '…' : ''}`
          : `${usable.length} words in`,
      );
    } catch {
      toast('error', 'Could not check that list');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="col" style={{ gap: 'var(--s5)' }}>
      {showModePicker && (
        <Group title="Mode">
          {/* One line per mode — the tagline only repeats the blurb underneath.
              Daily is not host-configurable, so it is not offered here. */}
          <div
            className="grid"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 'var(--s1)' }}
          >
            {MODE_LIST.filter((m) => m.id !== 'daily').map((mode) => {
              const active = mode.id === settings.mode;
              return (
                <button
                  key={mode.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => onChange({ mode: mode.id })}
                  className="row"
                  style={{
                    height: 32,
                    padding: '0 var(--s2)',
                    borderRadius: 'var(--r-sm)',
                    border: `1px solid ${active ? 'var(--accent)' : 'var(--line)'}`,
                    background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                    opacity: disabled ? 0.45 : 1,
                    transition: 'background 0.14s, border-color 0.14s',
                  }}
                >
                  <ModeIcon
                    name={mode.icon}
                    size={14}
                    color={active ? 'var(--accent)' : 'var(--text-faint)'}
                  />
                  <span
                    className="truncate"
                    style={{ fontSize: 13, fontWeight: active ? 'var(--w-bold)' : 'var(--w-normal)' }}
                  >
                    {mode.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="dim thin" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.4 }}>
            {firstSentence(descriptor.description)}
          </p>
        </Group>
      )}

      <Group title="Match">
        <div className="fields">
          <Field label="Rounds">
            <Stepper
              value={settings.rounds}
              min={1}
              max={Math.min(MAX_ROUNDS, settings.customWords?.length || MAX_ROUNDS)}
              disabled={locked('rounds')}
              onChange={(rounds) => onChange({ rounds })}
              format={(v) => `${v} ${v === 1 ? 'word' : 'words'}`}
            />
          </Field>

          <Field label="Time per round">
            <Stepper
              value={settings.roundSeconds}
              min={0}
              max={900}
              step={15}
              disabled={locked('roundSeconds')}
              onChange={(roundSeconds) => onChange({ roundSeconds })}
              format={(v) => (v === 0 ? 'No limit' : formatClock(v * 1000))}
            />
          </Field>

          <Field label="Players">
            <Stepper
              value={settings.maxPlayers}
              min={descriptor.minPlayers}
              max={descriptor.maxPlayers}
              disabled={locked('maxPlayers')}
              onChange={(maxPlayers) => onChange({ maxPlayers })}
              format={(v) => `up to ${v}`}
            />
          </Field>

          <Field label="Guess limit">
            <Stepper
              value={settings.guessLimit}
              min={0}
              max={200}
              step={5}
              disabled={locked('guessLimit')}
              onChange={(guessLimit) => onChange({ guessLimit })}
              format={(v) => (v === 0 ? 'Unlimited' : `${v} guesses`)}
            />
          </Field>

          <Field label="Hints" hint="each one costs points">
            <Stepper
              value={settings.hints}
              min={0}
              max={5}
              disabled={locked('hints')}
              onChange={(hints) => onChange({ hints })}
              format={(v) => (v === 0 ? 'None' : `${v} per round`)}
            />
          </Field>

          {/* The two mode-specific numbers stay on screen in every mode, inert
              where they do not apply — hiding them read as settings going missing. */}
          <Field label="Strikes" hint="sudden death only">
            <Stepper
              value={settings.strikes}
              min={1}
              max={5}
              disabled={locked('strikes') || settings.mode !== 'suddenDeath'}
              onChange={(strikes) => onChange({ strikes })}
              format={(v) => `${v} strikes`}
            />
          </Field>

          <Field label="Team guesses" hint="co-op only">
            <Stepper
              value={settings.teamGuessBudget}
              min={5}
              max={300}
              step={5}
              disabled={locked('teamGuessBudget') || settings.mode !== 'coop'}
              onChange={(teamGuessBudget) => onChange({ teamGuessBudget })}
              format={(v) => `${v} shared`}
            />
          </Field>
        </div>
      </Group>

      <Group title="Words">
        <div className="col" style={{ gap: 'var(--s3)' }}>
          <div className="fields">
            <Field label="Difficulty" hint={DIFFICULTY_BANDS[settings.difficulty].label.toLowerCase()}>
              <Segmented
                value={settings.difficulty}
                disabled={locked('difficulty')}
                onChange={(difficulty: Difficulty) => onChange({ difficulty })}
                options={DIFFICULTIES.map((d) => ({ value: d, label: d[0].toUpperCase() + d.slice(1) }))}
              />
            </Field>

            <Field label="What opponents see" hint={VISIBILITY_HINT[settings.visibility]}>
              <Segmented
                value={settings.visibility}
                disabled={locked('visibility')}
                onChange={(visibility: Visibility) => onChange({ visibility })}
                options={VISIBILITY.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))}
              />
            </Field>
          </div>

          {/* Eight categories will not fit a half-width column, so it keeps its own row. */}
          <Field label="Category" hint="narrows the pool">
            <Segmented
              value={settings.category}
              disabled={locked('category')}
              onChange={(category: Category) => onChange({ category })}
              options={CATEGORIES.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))}
            />
          </Field>
        </div>
      </Group>

      <Group title="Rules">
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(196px, 1fr))', gap: 'var(--s2)' }}
        >
          <Toggle
            label="End round on first find"
            hint="off: everyone plays the clock"
            checked={settings.endOnFirstFind}
            disabled={locked('endOnFirstFind')}
            onChange={(endOnFirstFind) => onChange({ endOnFirstFind })}
          />
          <Toggle
            label="Ranked"
            hint="duel and classic only"
            checked={settings.ranked}
            disabled={locked('ranked') || (settings.mode !== 'duel' && settings.mode !== 'classic')}
            onChange={(ranked) => onChange({ ranked })}
          />
          <Toggle
            label="Allow spectators"
            hint="watch without playing"
            checked={settings.allowSpectators}
            disabled={locked('allowSpectators')}
            onChange={(allowSpectators) => onChange({ allowSpectators })}
          />
          <Toggle
            label="Private room"
            hint="join by code only"
            checked={settings.private}
            disabled={locked('private')}
            onChange={(isPrivate) => onChange({ private: isPrivate })}
          />
          <Toggle
            label="Chat"
            checked={settings.chatEnabled}
            disabled={locked('chatEnabled')}
            onChange={(chatEnabled) => onChange({ chatEnabled })}
          />
          <Toggle
            label="Emotes"
            checked={settings.emotesEnabled}
            disabled={locked('emotesEnabled')}
            onChange={(emotesEnabled) => onChange({ emotesEnabled })}
          />
        </div>
      </Group>

      <div className="col" style={{ gap: 'var(--s3)' }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          style={{ alignSelf: 'flex-start' }}
          aria-expanded={advanced}
          onClick={() => setAdvanced((v) => !v)}
        >
          <span
            style={{
              display: 'flex',
              transform: advanced ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.14s',
            }}
          >
            <ModeIcon name="chevron" size={13} color="var(--text-faint)" />
          </span>
          {advanced ? 'Advanced' : 'Advanced: word list, seed, cold penalty'}
        </button>

        {advanced && (
          <div className="col" style={{ gap: 'var(--s3)' }}>
            <div className="col" style={{ gap: 'var(--s2)' }}>
              {/* Field does the dimming for the bare inputs; the steppers and
                  segmenteds dim themselves, so they are not given it twice. */}
              <Field label="Your own word list" hint="commas or spaces" disabled={disabled}>
                <textarea
                  className="input"
                  rows={2}
                  disabled={disabled}
                  value={wordDraft}
                  placeholder="volcano, harbour, nostalgia, pretzel"
                  onChange={(e) => setWordDraft(e.target.value)}
                />
              </Field>
              <div className="row">
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={disabled || checking}
                  onClick={() => void applyCustomWords()}
                >
                  {checking ? 'Checking…' : 'Check and apply'}
                </button>
                {settings.customWords && (
                  <span className="dim thin" style={{ fontSize: 13 }}>
                    {settings.customWords.length} words in use
                  </span>
                )}
              </div>
            </div>

            <div className="fields">
              <Field label="Seed" hint="same seed, same words" disabled={disabled}>
                <input
                  className="input"
                  disabled={disabled}
                  value={settings.seed ?? ''}
                  placeholder="blank for random"
                  maxLength={40}
                  onChange={(e) => onChange({ seed: e.target.value || null })}
                />
              </Field>

              <Field label="Cold penalty" hint="pause after a very cold guess">
                <Stepper
                  value={settings.coldPenaltySeconds}
                  min={0}
                  max={30}
                  step={1}
                  disabled={locked('coldPenaltySeconds')}
                  onChange={(coldPenaltySeconds) => onChange({ coldPenaltySeconds })}
                  format={(v) => (v === 0 ? 'Off' : `${v}s freeze`)}
                />
              </Field>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsSummary({ settings }: { settings: GameSettings }) {
  const bits = [
    `${settings.rounds} ${settings.rounds === 1 ? 'word' : 'words'}`,
    settings.roundSeconds ? `${formatClock(settings.roundSeconds * 1000)} each` : 'untimed',
    `up to ${settings.maxPlayers}`,
    settings.difficulty,
    settings.category !== 'any' ? settings.category : null,
    settings.guessLimit ? `${settings.guessLimit} guess cap` : null,
    settings.hints ? `${settings.hints} hints` : 'no hints',
    settings.customWords ? 'custom words' : null,
    settings.seed ? `seed ${settings.seed}` : null,
  ].filter(Boolean);

  return (
    <div className="row row--wrap">
      {settings.ranked && <span className="chip chip--accent">Ranked</span>}
      <span className="dim thin" style={{ fontSize: 13 }}>
        {bits.join(' · ')}
      </span>
    </div>
  );
}
