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
import { Avatar, EmptyState, Modal, Section, Spinner } from '../components/ui';
import { api, type PresetSummary } from '../lib/api';
import { cx, formatClock, modeLabel } from '../lib/format';
import { play, unlockAudio } from '../lib/sound';
import { useStore, type Tab } from '../lib/store';

/**
 * Four modes carry the grid. The rest are real modes, not filler, but eight
 * tiles competing at equal weight meant nobody read any of them.
 */
const FEATURED: GameMode[] = ['classic', 'duel', 'blitz', 'elimination'];

const FEATURED_MODES: ModeDescriptor[] = FEATURED.map((id) =>
  MODE_LIST.find((m) => m.id === id),
).filter((m): m is ModeDescriptor => m !== undefined);

// Daily is a tab of its own, so it never appears as a tile.
const MORE_MODES: ModeDescriptor[] = MODE_LIST.filter(
  (m) => m.id !== 'daily' && !FEATURED.includes(m.id),
);

const SHORTCUTS: { id: Tab; label: string; icon: string }[] = [
  { id: 'friends', label: 'Friends', icon: 'users' },
  { id: 'ranks', label: 'Ranks', icon: 'trophy' },
  { id: 'profile', label: 'Profile', icon: 'medal' },
  { id: 'stats', label: 'Stats', icon: 'chart' },
  { id: 'info', label: 'Info', icon: 'info' },
];

/** Server stats are staff-only, so the link to them is too. */
const STAFF_ROLES = ['moderator', 'admin'];

/**
 * The numbers that actually differ between modes, on one line. The prose
 * tagline lives on the tile's tooltip so the grid stays two lines a tile.
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

/** Home is the first thing anyone touches, so it is where audio gets its gesture. */
function tap(): void {
  unlockAudio();
  play('click');
}

export function Home() {
  const publicRooms = useStore((s) => s.publicRooms);
  const refreshLobby = useStore((s) => s.refreshLobby);
  const quickplay = useStore((s) => s.quickplay);
  const createRoom = useStore((s) => s.createRoom);
  const joinRoom = useStore((s) => s.joinRoom);
  const setTab = useStore((s) => s.setTab);
  const toast = useStore((s) => s.toast);
  const presence = useStore((s) => s.presence);
  const invites = useStore((s) => s.invites);
  const connected = useStore((s) => s.connected);
  const role = useStore((s) => s.user)?.role;

  const [code, setCode] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [busy, setBusy] = useState<GameMode | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // The lobby list arrives on a socket ack, which replaces the array whole. A
  // changed reference is therefore proof the server answered, and that is the
  // difference between "no open games" and "we have not asked yet".
  const [roomsAtMount] = useState(publicRooms);
  const lobbyAnswered = publicRooms !== roomsAtMount;

  useEffect(() => {
    refreshLobby();
    const id = window.setInterval(refreshLobby, 6000);
    return () => window.clearInterval(id);
  }, [refreshLobby]);

  // Only ticks while an invite is on screen. Invites are the one thing here
  // with a deadline; nothing else on this page needs a per-second re-render.
  useEffect(() => {
    if (invites.length === 0) return;
    // The clock can be minutes stale if this screen has been open a while, so
    // resync before the first tick rather than showing a wrong countdown.
    setNow(Date.now());
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      // Drop dead invites rather than leaving every screen to filter them out.
      // Emptying the list is also what stops this interval.
      for (const invite of useStore.getState().invites) {
        if (invite.expiresAt <= t) useStore.getState().dismissInvite(invite.id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [invites.length]);

  const shortcuts = SHORTCUTS.filter((s) => s.id !== 'stats' || STAFF_ROLES.includes(role ?? ''));
  // Covers the sub-second gap between an invite expiring and the tick above
  // clearing it out of the store.
  const pending = invites.filter((invite) => invite.expiresAt > now);

  async function launch(mode: GameMode, viaQuickplay: boolean) {
    tap();
    // Daily is an HTTP screen rather than a room, so it works with no socket.
    if (mode === 'daily') {
      setTab('daily');
      return;
    }
    setBusy(mode);
    try {
      if (viaQuickplay) await quickplay(mode);
      else await createRoom(defaultsForMode(mode));
    } finally {
      setBusy(null);
    }
  }

  // Everything that needs the socket. The store's room actions return silently
  // when there is none, so without this the buttons would look fine and do
  // nothing at all.
  const blocked = busy !== null || !connected;

  return (
    <div className="page" style={{ gap: 'var(--s4)' }}>
      {/* --------------------------------------------------------- invites */}
      {pending.length > 0 && (
        <div className="col" style={{ gap: 'var(--s1)' }}>
          {pending.map((invite) => (
            <motion.div
              key={invite.id}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className="row"
              style={{
                gap: 'var(--s3)',
                padding: 'var(--s2) var(--s3)',
                borderRadius: 'var(--r)',
                background: 'var(--accent-soft)',
                border: '1px solid var(--accent)',
              }}
            >
              <Avatar user={invite.from} size={28} />
              <span className="grow col" style={{ minWidth: 0, gap: 0 }}>
                <span className="truncate" style={{ fontSize: 13.5 }}>
                  <span className="bold">{invite.from.displayName}</span> invited you to{' '}
                  {modeLabel(invite.mode)}
                </span>
                <span className="faint thin mono" style={{ fontSize: 12 }}>
                  {formatClock(invite.expiresAt - now)} left · {invite.code}
                </span>
              </span>
              <button
                className="btn btn--primary btn--sm"
                disabled={!connected}
                onClick={() => {
                  tap();
                  void useStore.getState().acceptInvite(invite.code);
                }}
              >
                Accept
              </button>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  unlockAudio();
                  useStore.getState().dismissInvite(invite.id);
                }}
              >
                Dismiss
              </button>
            </motion.div>
          ))}
        </div>
      )}

      {/* ------------------------------------------------------ top actions */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="col"
        style={{ gap: 'var(--s2)' }}
      >
        {/* Wraps rather than letting the headline squeeze the count, which is
            the half of this row that changes. */}
        <div className="row row--between row--wrap" style={{ gap: 'var(--s3)' }}>
          <h1>Find the word before they do.</h1>
          <div className="row" style={{ gap: 'var(--s2)', flex: 'none' }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                flex: 'none',
                background: !connected
                  ? 'var(--orange)'
                  : presence.online > 0
                    ? 'var(--green)'
                    : 'var(--surface-3)',
              }}
            />
            {/* People mid-game are the number worth acting on, so that one
                takes the big type. Online is everyone connected, most of them
                sitting in menus. "0 in a game" would read as broken, hence the
                two fallbacks. And a headcount from before the socket dropped is
                worse than saying the connection is gone. The room total is not
                here on purpose: Open lobbies below counts the rooms you can
                actually join. */}
            <span className="row" style={{ gap: 'var(--s2)', alignItems: 'baseline' }}>
              <span className="bold mono" style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
                {!connected
                  ? 'Reconnecting'
                  : presence.inGame > 0
                    ? `${presence.inGame} in a game`
                    : presence.online > 0
                      ? `${presence.online} online`
                      : 'Quiet right now'}
              </span>
              {/* Only worth the space when it is a different number. The two
                  counts are sampled separately on the server, so they can
                  disagree for a tick, and a smaller "online" beside a larger
                  "in a game" reads as a bug. */}
              {connected && presence.inGame > 0 && presence.online > presence.inGame && (
                <span className="faint thin mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {presence.online} online
                </span>
              )}
            </span>
          </div>
        </div>

        <p className="dim thin" style={{ margin: 0, fontSize: 13.5 }}>
          Every guess comes back with a rank saying how close it is to the secret word. Rank 1
          is the word.
        </p>

        <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
          <button
            className="btn btn--primary btn--lg"
            disabled={blocked}
            onClick={() => void launch('classic', true)}
          >
            {busy === 'classic' ? <Spinner /> : <ModeIcon name="bolt" size={16} />}
            <span className="col" style={{ gap: 0, alignItems: 'flex-start', lineHeight: 1.25 }}>
              <span style={{ fontSize: 16 }}>Quick match</span>
              {/* Same ink as the label, dropped back. A second colour on the
                  accent fill would fail contrast in at least one theme. */}
              <span className="thin" style={{ fontSize: 12, opacity: 0.82 }}>
                ranked · 10 players
              </span>
            </span>
          </button>
          <button
            className="btn btn--lg"
            disabled={blocked}
            onClick={() => void launch('duel', true)}
          >
            {busy === 'duel' ? <Spinner /> : <ModeIcon name="swords" size={16} />}
            Duel
          </button>
          <button
            className="btn btn--lg"
            disabled={busy !== null}
            onClick={() => void launch('daily', false)}
          >
            <ModeIcon name="calendar" size={16} />
            Daily
          </button>
          <button
            className="btn btn--lg"
            disabled={blocked}
            onClick={() => {
              tap();
              setCustomOpen(true);
            }}
          >
            <ModeIcon name="plus" size={16} />
            Custom game
          </button>
        </div>
      </motion.section>

      {/* ------------------------------------------------------------ modes */}
      <Section
        title="Game modes"
        action={
          <button
            className="btn btn--ghost btn--sm"
            aria-expanded={showMore}
            onClick={() => {
              unlockAudio();
              setShowMore((v) => !v);
            }}
          >
            {showMore ? 'Fewer modes' : 'More modes'}
            <span
              style={{
                display: 'flex',
                transform: showMore ? 'rotate(90deg)' : 'none',
                transition: 'transform 0.14s',
              }}
            >
              <ModeIcon name="chevron" size={14} />
            </span>
          </button>
        }
      >
        <div className="col" style={{ gap: 'var(--s2)' }}>
          <ModeGrid modes={FEATURED_MODES} busy={busy} blocked={blocked} onPick={launch} />
          {showMore && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            >
              <ModeGrid modes={MORE_MODES} busy={busy} blocked={blocked} onPick={launch} />
            </motion.div>
          )}
        </div>
      </Section>

      {/* -------------------------------------------------- join + lobbies */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 'var(--s3) var(--s5)',
          alignItems: 'start',
        }}
      >
        <Section title="Join with a code">
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              tap();
              const trimmed = code.trim().toUpperCase();
              if (trimmed.length < 4) {
                toast('warn', 'Room codes are four characters');
                return;
              }
              void joinRoom(trimmed).then((joined) => {
                if (joined) setCode('');
              });
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
            <button className="btn btn--primary" type="submit" disabled={!connected}>
              Join
            </button>
          </form>
        </Section>

        <Section
          title="Open lobbies"
          action={
            <div className="row">
              <span className="faint thin" style={{ fontSize: 12 }}>
                {publicRooms.length} public
              </span>
              <button
                className="btn btn--ghost btn--sm"
                disabled={!connected}
                onClick={() => {
                  unlockAudio();
                  refreshLobby();
                }}
              >
                Refresh
              </button>
            </div>
          }
        >
          {publicRooms.length > 0 ? (
            // Capped so a busy night scrolls inside the list rather than
            // pushing the rest of the page off the screen.
            <div className="col" style={{ gap: 'var(--s1)', maxHeight: 152, overflowY: 'auto' }}>
              {publicRooms.map((room) => (
                // A room that already started seats you as a spectator. The
                // server decides that, and the live chip is the heads-up.
                <button
                  key={room.code}
                  type="button"
                  className="row"
                  disabled={!connected}
                  onClick={() => {
                    tap();
                    void joinRoom(room.code);
                  }}
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
          ) : !connected ? (
            <EmptyState
              icon={<ModeIcon name="globe" size={20} />}
              title="Not connected"
              hint="Open games appear here once the connection is back."
            />
          ) : !lobbyAnswered ? (
            <div
              className="row"
              style={{ gap: 'var(--s2)', padding: 'var(--s5)', justifyContent: 'center' }}
            >
              <Spinner />
              <span className="faint thin" style={{ fontSize: 13 }}>
                Looking for open games
              </span>
            </div>
          ) : (
            <EmptyState
              icon={<ModeIcon name="search" size={20} />}
              title="Nothing public right now"
              hint="Host a game and it shows up here."
            />
          )}
        </Section>
      </div>

      {/* -------------------------------------------------------- shortcuts */}
      <div
        className="row row--wrap"
        style={{ gap: 'var(--s1)', paddingTop: 'var(--s2)', borderTop: '1px solid var(--line)' }}
      >
        {shortcuts.map((shortcut) => (
          <button
            key={shortcut.id}
            className="btn btn--ghost btn--sm"
            onClick={() => {
              unlockAudio();
              useStore.getState().setTab(shortcut.id);
            }}
          >
            <ModeIcon name={shortcut.icon} size={14} />
            {shortcut.label}
          </button>
        ))}
      </div>

      <CustomGameModal open={customOpen} onClose={() => setCustomOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mode grid
 * ------------------------------------------------------------------ */

function ModeGrid({
  modes,
  busy,
  blocked,
  onPick,
}: {
  modes: ModeDescriptor[];
  busy: GameMode | null;
  blocked: boolean;
  onPick: (mode: GameMode, viaQuickplay: boolean) => void;
}) {
  // The meta line is the only thing that differs between one tile and the next,
  // so the column has to be wide enough to show all of it. At 160px the longest
  // of them lost its clock to the ellipsis, and four tiles left a fifth empty
  // slot hanging off the end of the row.
  return (
    <div
      className="grid"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(176px, 1fr))', gap: 'var(--s2)' }}
    >
      {modes.map((mode) => (
        <button
          key={mode.id}
          type="button"
          disabled={blocked}
          onClick={() => onPick(mode.id, false)}
          // The written-out description still exists, it just lives on hover.
          title={mode.tagline}
          className="panel panel--interactive col"
          style={{
            padding: 'var(--s3)',
            gap: 'var(--s1)',
            textAlign: 'left',
            alignItems: 'stretch',
            opacity: blocked && busy !== mode.id ? 0.5 : 1,
          }}
        >
          <div className="row" style={{ gap: 'var(--s2)' }}>
            <span style={{ display: 'flex', color: 'var(--accent)', flex: 'none' }}>
              {busy === mode.id ? <Spinner size={16} /> : <ModeIcon name={mode.icon} size={16} />}
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
  );
}

/* ------------------------------------------------------------------ *
 * Custom game
 * ------------------------------------------------------------------ */

function CustomGameModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const createRoom = useStore((s) => s.createRoom);
  const toast = useStore((s) => s.toast);
  const connected = useStore((s) => s.connected);

  const [settings, setSettings] = useState<GameSettings>(() => defaultsForMode('classic'));
  const [presets, setPresets] = useState<{ mine: PresetSummary[]; featured: PresetSummary[] }>({
    mine: [],
    featured: [],
  });
  const [presetStatus, setPresetStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // Bumped by Try again so the fetch effect re-runs; keeps one copy of it.
  const [presetReload, setPresetReload] = useState(0);
  const [presetName, setPresetName] = useState('');
  const [presetPublic, setPresetPublic] = useState(false);
  const [shareCode, setShareCode] = useState('');
  const [loadingShared, setLoadingShared] = useState(false);
  const [savingPreset, setSavingPreset] = useState(false);
  const [creating, setCreating] = useState(false);
  // Bumped whenever a preset replaces the whole settings object. The editor
  // seeds its own drafts (the word-list textarea, the Advanced disclosure)
  // from props on mount only, so it has to be remounted to show a loaded one.
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    // Closing and reopening while a slow response is still out would otherwise
    // let the stale one land on top of the fresh one.
    let live = true;
    setPresetStatus('loading');
    api
      .presets()
      .then((res) => {
        if (!live) return;
        setPresets(res);
        setPresetStatus('ready');
      })
      .catch(() => {
        if (live) setPresetStatus('error');
      });
    return () => {
      live = false;
    };
  }, [open, presetReload]);

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

  const savedList = [...presets.mine, ...presets.featured];

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
            disabled={creating || !connected}
            onClick={() => {
              play('click');
              setCreating(true);
              void createRoom(settings)
                .then((code) => {
                  if (code) onClose();
                })
                .finally(() => setCreating(false));
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
          {presetStatus === 'loading' ? (
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <Spinner size={14} />
              <span className="faint thin" style={{ fontSize: 13 }}>
                Loading saved setups
              </span>
            </div>
          ) : presetStatus === 'error' ? (
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <span className="faint thin" style={{ fontSize: 13 }}>
                Could not load your saved setups.
              </span>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => setPresetReload((n) => n + 1)}
              >
                Try again
              </button>
            </div>
          ) : savedList.length === 0 ? (
            <p className="faint thin" style={{ margin: 0, fontSize: 13 }}>
              Nothing saved yet. Save one below and you get a share code for it.
            </p>
          ) : (
            <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
              {savedList.map((preset) => (
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
              disabled={!shareCode.trim() || loadingShared}
              onClick={() => {
                setLoadingShared(true);
                void api
                  .loadPreset(shareCode.trim())
                  .then((preset) => {
                    applyPreset(preset.settings);
                    toast('success', `Loaded "${preset.name}"`);
                  })
                  .catch(() => toast('error', 'No preset with that code'))
                  .finally(() => setLoadingShared(false));
              }}
            >
              {loadingShared ? <Spinner size={14} /> : null}
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
              placeholder="Name this setup"
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
              disabled={!presetName.trim() || savingPreset}
              onClick={() => {
                setSavingPreset(true);
                void api
                  .savePreset(presetName.trim(), settings, presetPublic)
                  .then((saved) => {
                    setPresetName('');
                    setPresets((p) => ({ ...p, mine: [saved, ...p.mine] }));
                    // A save proves the endpoint is up, so clear an earlier
                    // load failure instead of hiding the list we just added to.
                    setPresetStatus('ready');
                    toast('success', `Saved. Share code ${saved.shareCode}`);
                  })
                  .catch(() => toast('error', 'Could not save that preset'))
                  .finally(() => setSavingPreset(false));
              }}
            >
              {savingPreset ? <Spinner size={14} /> : null}
              Save preset
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { CustomGameModal };
