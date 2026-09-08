import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  defaultsForMode,
  MODE_LIST,
  type GameMode,
  type GameSettings,
  type ModeDescriptor,
} from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { SettingsEditor, SettingsSummary } from '../components/SettingsEditor';
import { EmptyState, Modal, Section, Spinner } from '../components/ui';
import { api, type PresetSummary } from '../lib/api';
import { cx, formatClock, modeLabel } from '../lib/format';
import { useStore } from '../lib/store';

/**
 * The numbers that actually differ between modes, on one line. The prose
 * tagline moves to the tile's tooltip so eight modes fit in two rows instead
 * of eight paragraphs.
 */
function modeMeta(mode: ModeDescriptor): string {
  const s = defaultsForMode(mode.id);
  const players =
    mode.minPlayers === mode.maxPlayers
      ? `${mode.maxPlayers}p`
      : `${mode.minPlayers}–${mode.maxPlayers}p`;
  const rounds = s.rounds === 1 ? '1 round' : `${s.rounds} rounds`;
  const clock = s.roundSeconds > 0 ? formatClock(s.roundSeconds * 1000) : 'no clock';
  return `${players} · ${rounds} · ${clock}`;
}

export function Home() {
  const publicRooms = useStore((s) => s.publicRooms);
  const refreshLobby = useStore((s) => s.refreshLobby);
  const quickplay = useStore((s) => s.quickplay);
  const createRoom = useStore((s) => s.createRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const setTab = useStore((s) => s.setTab);
  const toast = useStore((s) => s.toast);

  const [code, setCode] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [busy, setBusy] = useState<GameMode | null>(null);

  useEffect(() => {
    refreshLobby();
    const id = window.setInterval(refreshLobby, 6000);
    return () => window.clearInterval(id);
  }, [refreshLobby]);

  async function launch(mode: GameMode, viaQuickplay: boolean) {
    setBusy(mode);
    try {
      if (mode === 'daily') {
        setTab('daily');
        return;
      }
      if (viaQuickplay) await quickplay(mode);
      else await createRoom(defaultsForMode(mode));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page" style={{ gap: 'var(--s4)' }}>
      {/* ---------------------------------------------------------- hero */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="col"
        style={{ gap: 'var(--s2)' }}
      >
        <h1>Find the word before they do.</h1>
        <p className="dim thin" style={{ margin: 0, fontSize: 13.5 }}>
          Every guess comes back with a rank — how close it is to the secret word. Rank 1 is the
          word.
        </p>
        <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
          <button
            className="btn btn--primary btn--lg"
            disabled={busy !== null}
            onClick={() => void launch('classic', true)}
          >
            {busy === 'classic' ? <Spinner /> : <ModeIcon name="bolt" size={16} />}
            Quick match
          </button>
          <button
            className="btn btn--lg"
            disabled={busy !== null}
            onClick={() => void launch('duel', true)}
          >
            {busy === 'duel' ? <Spinner /> : <ModeIcon name="swords" size={16} />}
            Find a duel
          </button>
          <button className="btn btn--lg" onClick={() => setCustomOpen(true)}>
            <ModeIcon name="plus" size={16} />
            Custom game
          </button>
          <span className="faint thin" style={{ fontSize: 12.5, maxWidth: 250 }}>
            quick match is 10 players and starts itself. custom game has the settings.
          </span>
        </div>
      </motion.section>

      {/* ---------------------------------------------------------- modes */}
      <Section
        title="Game modes"
        action={
          <span className="faint thin" style={{ fontSize: 12 }}>
            pick one to start it
          </span>
        }
      >
        <div
          className="grid"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', gap: 'var(--s2)' }}
        >
          {MODE_LIST.map((mode) => (
            <button
              key={mode.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void launch(mode.id, false)}
              // The written-out description still exists, it just lives on hover.
              title={mode.tagline}
              className="panel panel--interactive col"
              style={{
                padding: 'var(--s3)',
                gap: 2,
                textAlign: 'left',
                alignItems: 'stretch',
                opacity: busy !== null && busy !== mode.id ? 0.5 : 1,
              }}
            >
              <div className="row" style={{ gap: 'var(--s2)' }}>
                <span style={{ display: 'flex', color: 'var(--accent)', flex: 'none' }}>
                  {busy === mode.id ? (
                    <Spinner size={16} />
                  ) : (
                    <ModeIcon name={mode.icon} size={16} />
                  )}
                </span>
                <span className="bold grow truncate" style={{ fontSize: 14 }}>
                  {mode.name}
                </span>
              </div>
              <span className="faint truncate" style={{ fontSize: 12 }}>
                {modeMeta(mode)}
              </span>
            </button>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------- join + lobbies */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 'var(--s4) var(--s5)',
          alignItems: 'start',
        }}
      >
        <Section title="Join with a code">
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              const trimmed = code.trim().toUpperCase();
              if (trimmed.length < 4) {
                toast('warn', 'Room codes are four characters');
                return;
              }
              const joined = await joinRoom(trimmed);
              if (joined) setCode('');
            }}
          >
            <input
              className="input grow mono"
              style={{
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontWeight: 'var(--w-bold)',
              }}
              aria-label="Room code"
              placeholder="ABCD"
              // Four characters normally; the server's collision fallback can
              // hand out six, so the field still accepts those.
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <button className="btn btn--primary" type="submit">
              Join
            </button>
          </form>
          <span className="faint thin" style={{ fontSize: 12 }}>
            four characters, from whoever is hosting.
          </span>
        </Section>

        <Section
          title="Open lobbies"
          action={
            <div className="row">
              <span className="faint thin" style={{ fontSize: 12 }}>
                {publicRooms.length} public
              </span>
              <button className="btn btn--ghost btn--sm" onClick={refreshLobby}>
                Refresh
              </button>
            </div>
          }
        >
          {publicRooms.length === 0 ? (
            <EmptyState
              icon={<ModeIcon name="search" size={20} />}
              title="Nothing public right now"
              hint="Host a game and it shows up here."
            />
          ) : (
            // Capped so a busy night scrolls inside the list rather than
            // pushing the rest of the page off the screen.
            <div className="col" style={{ gap: 'var(--s1)', maxHeight: 168, overflowY: 'auto' }}>
              {publicRooms.map((room) => (
                // A room that already started seats you as a spectator — the
                // server decides that, the live chip is the heads-up.
                <button
                  key={room.code}
                  type="button"
                  className="row"
                  onClick={() => void joinRoom(room.code)}
                  style={{
                    gap: 'var(--s3)',
                    padding: '6px var(--s3)',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--surface-2)',
                    textAlign: 'left',
                  }}
                >
                  <span
                    className="mono bold"
                    style={{ fontSize: 14, letterSpacing: '0.1em', flex: 'none' }}
                  >
                    {room.code}
                  </span>
                  <span className="grow col" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontSize: 13.5 }}>
                      {modeLabel(room.mode)}
                    </span>
                    <span className="faint thin truncate" style={{ fontSize: 12 }}>
                      {room.hostName} · {room.difficulty}
                      {room.ranked ? ' · rated' : ''}
                    </span>
                  </span>
                  <span className="faint mono" style={{ fontSize: 12, flex: 'none' }}>
                    {room.players}/{room.maxPlayers}
                  </span>
                  {room.phase !== 'lobby' && <span className="chip chip--live">live</span>}
                </button>
              ))}
            </div>
          )}
        </Section>
      </div>

      <CustomGameModal open={customOpen} onClose={() => setCustomOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Custom game
 * ------------------------------------------------------------------ */

function CustomGameModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createRoom = useStore((s) => s.createRoom);
  const toast = useStore((s) => s.toast);

  const [settings, setSettings] = useState<GameSettings>(() => defaultsForMode('classic'));
  const [presets, setPresets] = useState<{ mine: PresetSummary[]; featured: PresetSummary[] }>({
    mine: [],
    featured: [],
  });
  const [presetName, setPresetName] = useState('');
  const [presetPublic, setPresetPublic] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [creating, setCreating] = useState(false);
  // Bumped whenever a preset replaces the whole settings object. The editor
  // seeds its own drafts (the word-list textarea, the Advanced disclosure)
  // from props on mount only, so it has to be remounted to show a loaded one.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    api
      .presets()
      .then(setPresets)
      .catch(() => undefined);
  }, [open]);

  function applyPreset(next: GameSettings) {
    setSettings(next);
    setEditorKey((k) => k + 1);
  }

  function patch(next: Partial<GameSettings>) {
    // Switching mode rebases onto that mode's defaults, matching the server's
    // sanitiser so the preview never disagrees with the room you get.
    setSettings((prev) =>
      next.mode && next.mode !== prev.mode
        ? { ...defaultsForMode(next.mode), ...next }
        : { ...prev, ...next },
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Custom game"
      width={640}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--primary"
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              const code = await createRoom(settings);
              setCreating(false);
              if (code) onClose();
            }}
          >
            {creating ? <Spinner /> : null}
            Create room
          </button>
        </>
      }
    >
      <div className="stack">
        <div className="col" style={{ gap: 'var(--s2)' }}>
          <div className="eyebrow">Saved setups</div>
          {presets.mine.length === 0 && presets.featured.length === 0 ? (
            <p className="faint thin" style={{ margin: 0, fontSize: 13 }}>
              Nothing saved yet. Save one below and you get a share code for it.
            </p>
          ) : (
            <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
              {[...presets.mine, ...presets.featured].map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="chip"
                  onClick={() => {
                    applyPreset(preset.settings);
                    toast('info', `Loaded "${preset.name}"`);
                  }}
                >
                  {preset.name}
                  {preset.author && <span className="faint"> · {preset.author}</span>}
                </button>
              ))}
            </div>
          )}
          <div className="row">
            <input
              className="input grow mono"
              aria-label="Preset share code"
              placeholder="Load by share code"
              value={shareCode}
              maxLength={10}
              onChange={(e) => setShareCode(e.target.value.toUpperCase())}
              style={{ textTransform: 'uppercase' }}
            />
            <button
              className="btn"
              type="button"
              disabled={!shareCode.trim()}
              onClick={async () => {
                try {
                  const preset = await api.loadPreset(shareCode.trim());
                  applyPreset(preset.settings);
                  toast('success', `Loaded "${preset.name}"`);
                } catch {
                  toast('error', 'No preset with that code');
                }
              }}
            >
              Load
            </button>
          </div>
        </div>

        <SettingsEditor key={editorKey} settings={settings} onChange={patch} />

        <div className="col" style={{ gap: 'var(--s2)' }}>
          <div className="eyebrow">Save this setup</div>
          <SettingsSummary settings={settings} />
          <div className="row">
            <input
              className="input grow"
              aria-label="Preset name"
              placeholder="name it, e.g. friday night carnage"
              value={presetName}
              maxLength={48}
              onChange={(e) => setPresetName(e.target.value)}
            />
            {/* Saving published every setup to the shared list whether you
                wanted that or not. The share code works either way; this only
                decides whether strangers see it. */}
            <button
              type="button"
              className={cx('chip', presetPublic && 'chip--accent')}
              aria-pressed={presetPublic}
              title="Public setups turn up in other people's saved list"
              style={{ flex: 'none', height: 30 }}
              onClick={() => setPresetPublic((v) => !v)}
            >
              {presetPublic ? 'public' : 'private'}
            </button>
            <button
              className="btn"
              type="button"
              disabled={!presetName.trim()}
              onClick={async () => {
                try {
                  const saved = await api.savePreset(presetName.trim(), settings, presetPublic);
                  setPresetName('');
                  setPresets((p) => ({ ...p, mine: [saved, ...p.mine] }));
                  toast('success', `Saved. Share code ${saved.shareCode}`);
                } catch {
                  toast('error', 'Could not save that preset');
                }
              }}
            >
              Save preset
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { CustomGameModal };
