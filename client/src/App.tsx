import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Wordmark } from './components/Logo';
import { ModeIcon } from './components/ModeIcon';
import { SoundToggle } from './components/SoundToggle';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { Avatar, Toasts } from './components/ui';
import { Boot } from './screens/Boot';
import { Daily } from './screens/Daily';
import { Friends } from './screens/Friends';
import { Game } from './screens/Game';
import { Home } from './screens/Home';
import { Info } from './screens/Info';
import { Leaderboard } from './screens/Leaderboard';
import { Lobby } from './screens/Lobby';
import { Profile } from './screens/Profile';
import { Results } from './screens/Results';
import { Statistics } from './screens/Statistics';
import { setActivity } from './lib/discord';
import { cx, modeLabel } from './lib/format';
import { play, setMusicMood, unlockAudio } from './lib/sound';
import { useStore, type Tab } from './lib/store';

const TABS: { id: Tab; label: string }[] = [
  { id: 'play', label: 'Play' },
  { id: 'daily', label: 'Daily' },
  { id: 'ranks', label: 'Ranks' },
  { id: 'friends', label: 'Friends' },
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
  const invites = useStore((s) => s.invites);

  useEffect(() => {
    void boot();
  }, [boot]);

  // Competitive-chill while a round is live, the calmer bed everywhere else.
  // Keyed on the room phase rather than the tab, so opening the leaderboard
  // mid-match does not swap the music out from under you.
  const inRound =
    room?.phase === 'countdown' || room?.phase === 'playing' || room?.phase === 'roundEnd';
  useEffect(() => {
    setMusicMood(inRound ? 'game' : 'menu');
  }, [inRound]);

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

  // Any click anywhere is a good enough gesture to let audio start. Browsers
  // will not resume an AudioContext without one, and waiting for a button that
  // happens to call unlockAudio() means the first few sounds are silently lost.
  const unlocked = useRef(false);
  useEffect(() => {
    if (unlocked.current) return;
    const onFirst = () => {
      unlocked.current = true;
      unlockAudio();
      window.removeEventListener('pointerdown', onFirst);
      window.removeEventListener('keydown', onFirst);
    };
    window.addEventListener('pointerdown', onFirst);
    window.addEventListener('keydown', onFirst);
    return () => {
      window.removeEventListener('pointerdown', onFirst);
      window.removeEventListener('keydown', onFirst);
    };
  }, []);

  if (status !== 'ready') return <Boot />;

  const inMatch = room && room.phase !== 'lobby' && room.phase !== 'matchEnd';
  const isStaff = user?.role === 'moderator' || user?.role === 'admin';

  /**
   * Which screen is showing, as one stable key.
   *
   * Deliberately NOT keyed on room.phase: countdown, playing and roundEnd are
   * all the Game screen, and keying on phase remounted it three times a round.
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

  const returnLabel = inMatch
    ? 'Return to match'
    : room?.phase === 'matchEnd'
      ? 'Return to results'
      : room
        ? `Return to lobby ${room.code}`
        : null;

  const goTo = (next: Tab) => {
    if (next !== tab) play('click');
    setTab(next);
  };

  return (
    <div className="app">
      <header className="app__header">
        <button onClick={() => goTo('play')} aria-label="Mivimoose Guess home" style={{ flex: 'none' }}>
          <Wordmark size={26} />
        </button>

        {room && tab !== 'play' && returnLabel && (
          <button
            className={cx('chip', inMatch && 'chip--live')}
            onClick={() => goTo('play')}
            title={returnLabel}
            style={{ flex: '0 1 auto', minWidth: 0 }}
          >
            <span className="truncate grow">{returnLabel}</span>
          </button>
        )}

        <nav className="app__nav">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            // Invites are time-limited, so the badge belongs where people look
            // for friends rather than only on the home screen.
            const badge = entry.id === 'friends' && invites.length > 0 ? invites.length : null;
            return (
              <button
                key={entry.id}
                className={cx('tab', active && 'tab--active')}
                aria-current={active ? 'page' : undefined}
                onClick={() => goTo(entry.id)}
              >
                {entry.label}
                {badge !== null && (
                  <span
                    style={{
                      marginLeft: 5,
                      padding: '0 5px',
                      borderRadius: 'var(--r-pill)',
                      background: 'var(--accent)',
                      color: 'var(--bg)',
                      fontSize: 10,
                      fontWeight: 'var(--w-bold)',
                    }}
                  >
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="row" style={{ gap: 'var(--s1)', flex: 'none' }}>
          {isStaff && (
            <button
              className={cx('btn btn--ghost btn--sm', tab === 'stats' && 'tab--active')}
              style={{ padding: '0 var(--s2)' }}
              title="Server statistics"
              aria-label="Server statistics"
              onClick={() => goTo('stats')}
            >
              <ModeIcon name="chart" size={15} />
            </button>
          )}
          <button
            className="btn btn--ghost btn--sm"
            style={{ padding: '0 var(--s2)' }}
            title="FAQ, terms and privacy"
            aria-label="FAQ, terms and privacy"
            onClick={() => goTo('info')}
          >
            <ModeIcon name="info" size={15} />
          </button>
          <SoundToggle />
          <ThemeSwitcher />
        </div>

        {user && (
          <button
            className="row"
            onClick={() => goTo('profile')}
            title={`${user.displayName} — your profile`}
            style={{ gap: 'var(--s2)', flex: 'none' }}
          >
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
          </button>
        )}
      </header>

      <div className="app__body">
        {/*
          No AnimatePresence around the screen swap and no exit animation. With
          `mode="wait"` the incoming screen waits for the outgoing one to report
          its exit finished, and the Game screen does not always report it — its
          guess rows animate with `layout`, and a layout animation still running
          when the screen unmounts can swallow the callback. That left the app
          on a permanently blank page with the socket still connected.
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
          {tab === 'friends' && <Friends />}
          {tab === 'profile' && <Profile />}
          {tab === 'stats' && <Statistics />}
          {tab === 'info' && <Info />}
        </motion.div>
      </div>

      <Toasts />
    </div>
  );
}
