import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { ProfileStats } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { Avatar, EmptyState, Panel, Section, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { formatDuration, modeLabel, ordinal, percent, relativeTime } from '../lib/format';

/* Both lists are capped and scroll internally: a long match history should not
   push the achievements off the bottom of a 640px-tall Activity frame. */
const listBox = { maxHeight: 176, overflowY: 'auto' as const };

const rowStyle = (first: boolean) => ({
  gap: 'var(--s3)',
  padding: 'var(--s1) 0',
  borderTop: first ? undefined : '1px solid var(--line)',
});

export function Profile() {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .profile()
      .then(setStats)
      .catch(() => setError('the server did not answer.'));
  }, []);

  useEffect(load, [load]);

  if (error) {
    return (
      <div className="page">
        <EmptyState title="Could not load your profile" hint={error} />
        {/* The failure is usually a dropped connection, so the screen needs a
            way back in — otherwise switching tabs is the only retry. */}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn--sm" onClick={load}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="page">
        <div className="row" style={{ justifyContent: 'center', padding: 'var(--s7) 0' }}>
          <Spinner size={22} />
        </div>
      </div>
    );
  }

  /* Clamped: a level-up that lands mid-request can report more XP into the
     level than the level is worth, and an unclamped fill overruns its groove. */
  const xpFraction =
    stats.xpForLevel > 0 ? Math.min(1, Math.max(0, stats.xpIntoLevel / stats.xpForLevel)) : 0;
  const unlocked = stats.achievements.filter((a) => a.unlockedAt !== null).length;
  const modes = stats.perMode.filter((m) => m.matches > 0).sort((a, b) => b.matches - a.matches);

  return (
    <div className="page">
      {/* ---------------------------------------------------------- header */}
      <header className="row row--wrap" style={{ gap: 'var(--s4)' }}>
        <Avatar user={stats.user} size={48} />
        <div className="grow col" style={{ gap: 'var(--s2)', minWidth: 200 }}>
          <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
            {/* minWidth 0 or a long name refuses to shrink and overflows the row. */}
            <h1 className="truncate" style={{ fontSize: 21, minWidth: 0 }}>
              {stats.user.displayName}
            </h1>
            <span className="bold" style={{ fontSize: 14 }}>
              Level {stats.level}
            </span>
            <span className="dim thin mono" style={{ fontSize: 14 }}>
              {stats.user.rating} Elo
            </span>
            {stats.user.title && <span className="chip chip--accent">{stats.user.title}</span>}
            {stats.currentStreak > 1 && (
              <span className="chip chip--live">{stats.currentStreak} win streak</span>
            )}
          </div>

          {/* The track is a quiet groove; only the fill carries colour. The
              numbers sit beside the bar rather than above it to save a row. */}
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <div
              className="grow"
              role="progressbar"
              aria-label={`XP toward level ${stats.level + 1}`}
              aria-valuemin={0}
              aria-valuemax={stats.xpForLevel}
              aria-valuenow={stats.xpIntoLevel}
              style={{
                height: 6,
                borderRadius: 'var(--r-pill)',
                background: 'var(--surface-2)',
                overflow: 'hidden',
              }}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${xpFraction * 100}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  height: '100%',
                  borderRadius: 'var(--r-pill)',
                  background: 'var(--accent)',
                }}
              />
            </div>
            <span className="faint mono" style={{ fontSize: 12, flex: 'none' }}>
              {stats.xpIntoLevel.toLocaleString()} / {stats.xpForLevel.toLocaleString()} XP to level{' '}
              {stats.level + 1}
            </span>
          </div>
        </div>
      </header>

      {/* ---------------------------------------------------------- stats */}
      {/* Seven metrics is the most that still lands on one row at 880px. */}
      <Panel bodyClass="metrics">
        <Stat label="Matches" value={stats.matches.toLocaleString()} />
        <Stat label="Wins" value={stats.wins.toLocaleString()} sub={percent(stats.winRate)} />
        <Stat label="Words found" value={stats.wordsFound.toLocaleString()} />
        <Stat
          label="Avg guesses"
          value={stats.averageGuesses ? stats.averageGuesses.toFixed(1) : '—'}
        />
        <Stat label="Fastest find" value={formatDuration(stats.fastestFindMs)} />
        <Stat
          label="Streak"
          value={stats.currentStreak.toLocaleString()}
          sub={`best ${stats.bestStreak}`}
        />
        <Stat label="XP" value={stats.xp.toLocaleString()} />
      </Panel>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 'var(--s5)' }}
      >
        {/* -------------------------------------------------------- modes */}
        <Section title="By mode">
          {modes.length === 0 ? (
            <EmptyState title="No games yet" hint="wins and elo per mode land here." />
          ) : (
            <div className="col" style={listBox}>
              {modes.map((m, i) => (
                <div key={m.mode} className="row" style={rowStyle(i === 0)}>
                  <span className="grow truncate" style={{ fontSize: 14 }}>
                    {modeLabel(m.mode)}
                  </span>
                  <span
                    className="faint thin mono"
                    style={{ fontSize: 13 }}
                    title={`${m.wins} wins from ${m.matches}`}
                  >
                    {m.wins}/{m.matches}
                  </span>
                  <span
                    className="mono bold"
                    style={{ fontSize: 14, minWidth: 42, textAlign: 'right' }}
                  >
                    {m.rating}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* -------------------------------------------------------- recent */}
        <Section title="Recent">
          {stats.recent.length === 0 ? (
            <EmptyState title="No matches yet" hint="your last few games, newest first." />
          ) : (
            <div className="col" style={listBox}>
              {stats.recent.map((match, i) => (
                <div key={match.matchId} className="row" style={rowStyle(i === 0)}>
                  <span
                    className="mono bold"
                    style={{
                      width: 30,
                      flex: 'none',
                      fontSize: 13,
                      color: match.placement === 1 ? 'var(--green)' : 'var(--text-faint)',
                    }}
                  >
                    {ordinal(match.placement)}
                  </span>
                  <span className="grow truncate" style={{ fontSize: 14 }}>
                    {modeLabel(match.mode)}
                  </span>
                  <span className="faint thin mono" style={{ fontSize: 13 }}>
                    {match.players}p
                  </span>
                  <span className="faint thin" style={{ fontSize: 13 }}>
                    {relativeTime(match.playedAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      {/* ---------------------------------------------------------- badges */}
      <Section
        title="Achievements"
        action={
          <span className="faint thin mono" style={{ fontSize: 13 }}>
            {unlocked}/{stats.achievements.length}
          </span>
        }
      >
        {/* The badge set is server-driven and open-ended, so it is the one block
            that could grow the page without limit. Capped like the two lists
            above: three rows show, the rest scroll. */}
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
            gap: 'var(--s2)',
            maxHeight: 132,
            overflowY: 'auto',
          }}
        >
          {stats.achievements.map((achievement) => {
            const unlockedAt = achievement.unlockedAt;
            /* Description and unlock date are the tooltip, not two more lines:
               at this card size the grid is a glance, not a reading task. */
            const tip =
              unlockedAt === null
                ? achievement.description
                : `${achievement.description} — got it ${relativeTime(unlockedAt)}`;
            return (
              <div
                key={achievement.id}
                className="row"
                title={tip}
                style={{
                  gap: 'var(--s2)',
                  padding: 'var(--s2)',
                  borderRadius: 'var(--r-sm)',
                  /* surface-2, not surface: on the light themes surface is all
                     but the page colour and the cards disappear into it. */
                  background: 'var(--surface-2)',
                  opacity: unlockedAt === null ? 0.5 : 1,
                }}
              >
                <ModeIcon
                  name={achievement.icon}
                  size={15}
                  color={unlockedAt === null ? 'var(--text-faint)' : 'var(--green)'}
                />
                <span className="truncate" style={{ fontSize: 13 }}>
                  {achievement.name}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="metric__label">{label}</div>
      <div className="metric__value">
        {value}
        {sub && (
          <span className="faint thin" style={{ fontSize: 12, marginLeft: 'var(--s1)' }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}
