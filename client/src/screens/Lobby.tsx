import { useState } from 'react';
import { motion } from 'framer-motion';
import { MODES, type RoomState } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { PlayerCard } from '../components/game';
import { SettingsEditor, SettingsSummary } from '../components/SettingsEditor';
import { Avatar, CopyButton, Section } from '../components/ui';
import { useCountdown } from '../hooks/useCountdown';
import { cx, formatClock } from '../lib/format';
import { useStore } from '../lib/store';

/**
 * The server will not schedule a quick match under two people whatever the
 * mode's own minimum is (AUTO_START_MIN_PLAYERS in server/src/game/Room.ts).
 * Classic allows a lobby of one, so without this the screen would promise a
 * start that the server is never going to schedule.
 */
const QUICK_MATCH_MIN_PLAYERS = 2;

export function Lobby({ room }: { room: RoomState }) {
  const user = useStore((s) => s.user);
  const clockOffset = useStore((s) => s.clockOffset);
  const setReady = useStore((s) => s.setReady);
  const startMatch = useStore((s) => s.startMatch);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const updateSettings = useStore((s) => s.updateSettings);
  const kick = useStore((s) => s.kick);
  const transferHost = useStore((s) => s.transferHost);

  const [showSettings, setShowSettings] = useState(true);

  const isHost = room.hostId === user?.id;
  const me = room.players.find((p) => p.user.id === user?.id);
  const descriptor = MODES[room.mode];
  const needed = room.autoStart
    ? Math.max(QUICK_MATCH_MIN_PLAYERS, descriptor.minPlayers)
    : descriptor.minPlayers;
  const missing = Math.max(0, needed - room.players.length);
  const readyCount = room.players.filter((p) => p.status === 'ready').length;

  // Only a quick-match lobby counts down. In a host-run room `deadline` belongs
  // to the round clock, not to the lobby, so we deliberately do not tick on it.
  const startsAt = room.autoStart ? room.deadline : null;
  const ticking = useCountdown(startsAt, clockOffset);
  // useCountdown fills its state from an effect, so its first render is null
  // even when a deadline is already set. Falling back to the raw deadline stops
  // the lobby flashing "waiting for…" for a frame each time the clock starts.
  const startsIn =
    startsAt === null ? null : (ticking ?? Math.max(0, startsAt - (Date.now() + clockOffset)));

  const waitingCopy =
    missing === 0
      ? 'starting soon'
      : missing === 1
        ? 'waiting for one more player'
        : `waiting for ${missing} more players`;

  // One primary button per column. In a host-run room the start button owns
  // that emphasis; in a quick match there is no start button, so ready does.
  const readyIsPrimary = me?.status !== 'ready' && (room.autoStart || !isHost);

  return (
    <div className="page">
      {/* ------------------------------------------ room code + mode, one row */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="panel"
      >
        <div
          className="panel__body row row--between row--wrap"
          style={{ gap: 'var(--s4)', padding: 'var(--s3) var(--s4)' }}
        >
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <div className="col">
              <span className="eyebrow">Room code</span>
              <h1 className="mono" style={{ fontSize: 26, letterSpacing: '0.12em', lineHeight: 1.15 }}>
                {room.code}
              </h1>
            </div>
            <CopyButton value={room.code} />
          </div>

          <div className="col" style={{ gap: 1, minWidth: 160 }}>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <ModeIcon name={descriptor.icon} size={16} color="var(--text-dim)" />
              <h2>{descriptor.name}</h2>
              {room.autoStart && <span className="chip chip--accent">Quick match</span>}
            </div>
            <span className="thin faint" style={{ fontSize: 12.5 }}>
              {descriptor.tagline}
            </span>
          </div>
        </div>
      </motion.section>

      <div className="lobby-grid">
        {/* -------------------------------------------------------- players */}
        <div className="col" style={{ gap: 'var(--s4)' }}>
          <Section
            title={
              <>
                Players{' '}
                <span className="faint">
                  {room.players.length}/{room.settings.maxPlayers}
                </span>
              </>
            }
            action={
              <span className="dim" style={{ fontSize: 13 }}>
                {readyCount} ready
              </span>
            }
          >
            {/* A full ten-player roster is taller than the viewport on its own,
                so it scrolls here rather than pushing ready/start off screen. */}
            <div className="lobby-roster">
              {room.players.map((player) => (
                <PlayerCard
                  key={player.user.id}
                  player={player}
                  isMe={player.user.id === user?.id}
                  compact
                  onKick={isHost && player.user.id !== user?.id ? () => kick(player.user.id) : undefined}
                  onPromote={
                    isHost && player.user.id !== user?.id ? () => transferHost(player.user.id) : undefined
                  }
                />
              ))}
              {/* Two placeholders read as "room for more" just as well as ten,
                  and ten pushed the buttons off a short screen. */}
              {Array.from({
                length: Math.max(0, Math.min(2, room.settings.maxPlayers - room.players.length)),
              }).map((_, i) => (
                <div key={`slot-${i}`} className="lobby-seat faint">
                  empty seat
                </div>
              ))}
            </div>

            {room.spectators.length > 0 && (
              <div className="col" style={{ gap: 'var(--s1)' }}>
                <span className="eyebrow">Watching ({room.spectators.length})</span>
                <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
                  {room.spectators.map((spectator) => (
                    <span key={spectator.id} className="chip" style={{ paddingLeft: 'var(--s1)' }}>
                      <Avatar user={spectator} size={18} />
                      {spectator.displayName}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <div className="col" style={{ gap: 'var(--s2)' }}>
            {me && (
              <button
                className={cx('btn btn--block', readyIsPrimary && 'btn--primary')}
                onClick={() => setReady(me.status !== 'ready')}
              >
                {me.status === 'ready' ? 'Not ready' : "I'm ready"}
              </button>
            )}

            {room.autoStart ? (
              // Nobody starts a quick match — it goes off on the server's clock,
              // so this slot is a status line rather than a control.
              <div className="row" style={{ justifyContent: 'center', gap: 'var(--s2)', minHeight: 38 }}>
                {startsIn === null ? (
                  <span className="faint thin" style={{ fontSize: 13 }} aria-live="polite">
                    {waitingCopy}
                  </span>
                ) : (
                  <>
                    <span className="dim" style={{ fontSize: 13 }}>
                      starting in
                    </span>
                    <span className="mono bold" style={{ fontSize: 18, color: 'var(--accent)' }}>
                      {formatClock(startsIn)}
                    </span>
                  </>
                )}
              </div>
            ) : isHost ? (
              <button
                className="btn btn--primary btn--lg btn--block"
                disabled={missing > 0}
                onClick={startMatch}
                title={missing > 0 ? `${descriptor.name} needs ${descriptor.minPlayers} players` : undefined}
              >
                <ModeIcon name="bolt" size={16} />
                {missing > 0 ? `Waiting for ${missing} more` : 'Start the match'}
              </button>
            ) : (
              <div className="faint thin" style={{ fontSize: 13, textAlign: 'center' }}>
                waiting on the host to start
              </div>
            )}

            <button className="btn btn--ghost btn--block" onClick={leaveRoom}>
              Leave room
            </button>
          </div>
        </div>

        {/* -------------------------------------------------------- settings */}
        <Section
          title="Settings"
          action={
            room.autoStart ? undefined : (
              <button
                className="btn btn--ghost btn--sm"
                aria-expanded={showSettings}
                onClick={() => setShowSettings((v) => !v)}
              >
                {showSettings ? 'Hide' : 'Show'}
              </button>
            )
          }
        >
          <span className="thin faint" style={{ fontSize: 12.5 }}>
            {room.autoStart
              ? 'quick match runs a fixed setup. host a custom game to change any of it.'
              : isHost
                ? 'you are the host — changes apply as you make them'
                : 'only the host can change these'}
          </span>

          {room.autoStart || !showSettings ? (
            <SettingsSummary settings={room.settings} />
          ) : (
            // The editor is long. Scroll it in place so the page itself stays
            // one screen tall.
            <div className="settings-scroll">
              <SettingsEditor settings={room.settings} disabled={!isHost} onChange={updateSettings} />
            </div>
          )}
        </Section>
      </div>

      <style>{`
        .lobby-grid {
          display: grid;
          grid-template-columns: minmax(0, 296px) minmax(0, 1fr);
          gap: var(--s5);
        }
        .lobby-roster {
          display: flex;
          flex-direction: column;
          gap: var(--s2);
          max-height: clamp(180px, 38vh, 380px);
          overflow-y: auto;
          padding-right: var(--s1);
        }
        .lobby-seat {
          display: flex;
          align-items: center;
          flex: none;
          height: 36px;
          padding: 0 var(--s3);
          border-radius: var(--r);
          border: 1px dashed var(--line-strong);
          font-size: 12.5px;
        }
        .settings-scroll {
          max-height: clamp(220px, 46vh, 420px);
          overflow-y: auto;
          padding-right: var(--s2);
        }
        /* Collapses below the width the two columns actually need, not at 900px
           — a 900x640 window should still get both of them side by side. */
        @media (max-width: 760px) {
          .lobby-grid { grid-template-columns: minmax(0, 1fr); }
          .lobby-roster { max-height: none; overflow-y: visible; padding-right: 0; }
          .settings-scroll { max-height: none; overflow-y: visible; padding-right: 0; }
        }
      `}</style>
    </div>
  );
}
