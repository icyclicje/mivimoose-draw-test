import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Wordmark } from './components/Logo';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { Avatar, Toasts } from './components/ui';
import { Boot } from './screens/Boot';
import { Daily } from './screens/Daily';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Leaderboard } from './screens/Leaderboard';
import { Lobby } from './screens/Lobby';
import { Profile } from './screens/Profile';
import { Results } from './screens/Results';
import { setActivity } from './lib/discord';
import { cx, modeLabel } from './lib/format';
import { useStore, type Tab } from './lib/store';

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'daily', label: 'Daily' },
  { id: 'ranks', label: 'Ranks' },
  { id: 'profile', label: 'You' },
];

export default function App() {
  const status = useStore((s) => s.status);
  const boot = useStore((s) => s.boot);
  const user = useStore((s) => s.user);
  const room = useStore((s) => s.room);
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const connected = useStore((s) => s.connected);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Mirror what the player is doing onto their Discord presence.
  useEffect(() => {
    if (!room) {
      void setActivity('Mivimoose Guess', 'Browsing');
      return;
    }
    const detail = modeLabel(room.mode);
    const state =
      room.phase === 'lobby'
        ? `In a lobby · ${room.code}`
        : room.phase === 'matchEnd'
          ? 'Match over'
          : `Round ${room.round} of ${room.totalRounds}`;
    void setActivity(detail, state);
  }, [room?.mode, room?.phase, room?.round, room?.totalRounds, room?.code, room]);

  if (status !== 'ready') return <Boot />;

  const inMatch = room && room.phase !== 'lobby' && room.phase !== 'matchEnd';

  /**
   * Which screen is showing, as one stable key.
   *
   * Deliberately NOT keyed on room.phase: countdown, playing and roundEnd are
   * all the Game screen, and keying on phase remounted it three times a round.
   * That threw away the overlay exit animations and reset local state like the
   * open/closed chat drawer every single round.
   */
  const screenKey =
    tab !== 'play'
      ? tab
      : !room
        ? 'home'
        : room.phase === 'lobby'
          ? 'lobby'
          : room.phase === 'matchEnd'
            ? 'results'
            : 'game';

  // The one thing that must never be hard to find: the way back into a game
  // you are already in. It is a genuine live status, so it earns a chip.
  const returnLabel = inMatch
    ? 'Return to match'
    : room?.phase === 'matchEnd'
      ? 'Return to results'
      : room
        ? `Return to lobby ${room.code}`
        : null;

  return (
    <div className="app">
      <header className="app__header">
        <button onClick={() => setTab('play')} aria-label="Mivimoose Guess home" style={{ flex: 'none' }}>
          <Wordmark size={26} />
        </button>

        {room && tab !== 'play' && returnLabel && (
          <button
            className={cx('chip', inMatch && 'chip--live')}
            onClick={() => setTab('play')}
            title={returnLabel}
            style={{ flex: '0 1 auto', minWidth: 0 }}
          >
            <span className="truncate grow">{returnLabel}</span>
          </button>
        )}

        <nav className="app__nav">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                className={cx('tab', active && 'tab--active')}
                aria-current={active ? 'page' : undefined}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div className="row" style={{ gap: 'var(--s2)', flex: 'none' }}>
          <ThemeSwitcher />
        </div>

        {user && (
          <div className="row" style={{ gap: 'var(--s2)', flex: 'none' }}>
            <span
              role="img"
              aria-label={connected ? 'Connected' : 'Reconnecting'}
              title={connected ? 'Connected' : 'Reconnecting'}
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                flex: 'none',
                background: connected ? 'var(--green)' : 'var(--pink)',
                animation: connected ? undefined : 'pulse-soft 1s infinite',
              }}
            />
            <Avatar user={user} size={26} />
          </div>
        )}
      </header>

      <div className="app__body">
        {/*
          No AnimatePresence around the screen swap, and no exit animation.
          It used to be `mode="wait"`, which holds the incoming screen back
          until the outgoing one reports its exit finished — and the outgoing
          Game screen does not always report it. Its guess rows animate with
          `layout`, and a layout animation still in flight when the screen is
          removed can swallow the exit-complete callback. The old screen was
          then left sitting at opacity 0 with the new one never mounted: a
          blank page, permanently, with the socket still happily connected.

          It showed up as "the match ended and I got a blank page" and as a
          game that sometimes never loaded when starting or rejoining, because
          it depended on whether anything happened to be animating at the
          moment the screen changed.

          A keyed motion.div still remounts and plays `initial` -> `animate` on
          every change, so the fade-in survives; only the fade-out is gone, and
          with it any way for an animation to strand a player.
        */}
        <motion.div
          key={screenKey}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        >
          {tab === 'play' && !room && <Home />}
          {tab === 'play' && room?.phase === 'lobby' && <Lobby room={room} />}
          {tab === 'play' &&
            room &&
            (room.phase === 'countdown' || room.phase === 'playing' || room.phase === 'roundEnd') && (
              <Game room={room} />
            )}
          {tab === 'play' && room?.phase === 'matchEnd' && <Results room={room} />}
          {tab === 'daily' && <Daily />}
          {tab === 'ranks' && <Leaderboard />}
          {tab === 'profile' && <Profile />}
        </motion.div>
      </div>

      <Toasts />
    </div>
  );
}
