import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  bandForRank,
  type FriendSummary,
  type GuessPath,
  type MatchReplay,
  type ProfileStats,
} from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { RankProgress, RoleBadge } from '../components/RankBadge';
import { Avatar, EmptyState, Modal, Panel, Section, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import {
  bandColor,
  formatClock,
  formatDuration,
  formatRank,
  modeLabel,
  ordinal,
  percent,
  relativeTime,
} from '../lib/format';
import { play, unlockAudio } from '../lib/sound';
import { useStore } from '../lib/store';

type RecentMatch = ProfileStats['recent'][number];

/** What the replay modal is showing right now. */
type ReplayView =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; replay: MatchReplay };

/* The friends preview is a separate request from the profile, so it needs its
   own three states. An empty array and a failed request are not the same thing
   and must not render the same. */
type FriendsView =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; list: FriendSummary[] };

/* Every list here is capped and scrolls inside itself. The screen has to land
   inside a 680px-tall Activity frame, and match history, friends and
   achievements are all server-driven and open-ended, so any one of them would
   otherwise push the rest off the bottom. */
const RECENT_BOX = { maxHeight: 168, overflowY: 'auto' as const };
const FRIENDS_CAP = 6;

export function Profile() {
  const [stats, setStats] = useState<ProfileStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [friends, setFriends] = useState<FriendsView>({ phase: 'loading' });

  const [openMatch, setOpenMatch] = useState<RecentMatch | null>(null);
  const [view, setView] = useState<ReplayView>({ phase: 'loading' });

  /* Which replay the open modal is actually waiting for. Two quick clicks fire
     two requests, and without this the slower one can land last and paint the
     wrong match into an already-reopened modal. */
  const wanted = useRef<string | null>(null);

  /* Same guard for the profile itself: "Try again" can be pressed faster than
     the server answers, and the stale reply must not overwrite the fresh one. */
  const profileSeq = useRef(0);

  // Re-read the preview whenever the server says the friend list moved.
  const friendsVersion = useStore((s) => s.friendsVersion);

  const load = useCallback(() => {
    const seq = ++profileSeq.current;
    setError(null);
    api
      .profile()
      .then((next) => {
        if (profileSeq.current === seq) setStats(next);
      })
      .catch(() => {
        if (profileSeq.current === seq) setError('Could not reach the server.');
      });
  }, []);

  useEffect(() => {
    load();
    // Bumping the sequence on unmount drops any reply that lands afterwards.
    return () => {
      profileSeq.current += 1;
    };
  }, [load]);

  useEffect(() => {
    let live = true;
    api
      .friends()
      .then((list) => {
        if (live) setFriends({ phase: 'ready', list: list.friends });
      })
      .catch(() => {
        // A failed refresh must not wipe a list that is already on screen.
        if (live) setFriends((prev) => (prev.phase === 'ready' ? prev : { phase: 'error' }));
      });
    return () => {
      live = false;
    };
  }, [friendsVersion]);

  const retry = useCallback(() => {
    unlockAudio();
    play('click');
    load();
  }, [load]);

  const openReplay = useCallback((match: RecentMatch) => {
    unlockAudio();
    play('click');
    wanted.current = match.matchId;
    setOpenMatch(match);
    setView({ phase: 'loading' });
    api
      .replay(match.matchId)
      .then((replay) => {
        if (wanted.current === match.matchId) setView({ phase: 'ready', replay });
      })
      .catch((err: unknown) => {
        if (wanted.current !== match.matchId) return;
        /* 404 is the only failure we can explain: old matches age out of
           storage. Everything else is a transport problem, and saying the
           match is gone when the network dropped is simply wrong. */
        const message =
          err instanceof ApiError && err.status === 404
            ? 'This match is no longer stored.'
            : 'Could not load the replay.';
        setView({ phase: 'error', message });
      });
  }, []);

  const closeReplay = useCallback(() => {
    wanted.current = null;
    setOpenMatch(null);
  }, []);

  if (error) {
    return (
      <div className="page">
        <EmptyState title="Could not load your profile" hint={error} />
        {/* The failure is usually a dropped connection, so the screen needs a
            way back in. Otherwise switching tabs is the only retry. */}
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn--sm" onClick={retry}>
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

  return (
    <div className="page">
      {/* ---------------------------------------------------------- header */}
      <header className="row row--wrap" style={{ gap: 'var(--s4)' }}>
        <Avatar user={stats.user} size={48} />

        <div className="grow col" style={{ gap: 'var(--s2)', minWidth: 220 }}>
          <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
            {/* minWidth 0 or a long name refuses to shrink and overflows the row. */}
            <h1 className="truncate" style={{ fontSize: 21, minWidth: 0 }}>
              {stats.user.displayName}
            </h1>
            <RoleBadge user={stats.user} />
            <span className="chip">Level {stats.level}</span>
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
              /* A zero max would make the bar meaningless to a screen reader,
                 so it never goes below 1. */
              aria-valuemax={Math.max(1, stats.xpForLevel)}
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
              {stats.xpIntoLevel.toLocaleString()} / {stats.xpForLevel.toLocaleString()} XP
            </span>
          </div>
        </div>

        {/* Rank is the headline of this screen, so it gets a column of its own
            rather than one more chip in the name row. */}
        <div style={{ flex: '0 1 240px', minWidth: 200 }}>
          <RankProgress rating={stats.user.rating} />
        </div>
      </header>

      {/* ---------------------------------------------------------- stats */}
      <Panel bodyClass="metrics">
        <Stat label="Matches" value={stats.matches.toLocaleString()} />
        <Stat label="Wins" value={stats.wins.toLocaleString()} sub={percent(stats.winRate)} />
        <Stat label="Words found" value={stats.wordsFound.toLocaleString()} />
        <Stat
          label="Avg guesses"
          value={stats.averageGuesses ? stats.averageGuesses.toFixed(1) : 'none yet'}
        />
        <Stat label="Fastest find" value={formatDuration(stats.fastestFindMs)} />
        <Stat
          label="Best streak"
          value={stats.bestStreak.toLocaleString()}
          sub={`now ${stats.currentStreak}`}
        />
      </Panel>

      <div
        className="grid"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s5)' }}
      >
        {/* -------------------------------------------------------- recent */}
        <Section
          title="Recent games"
          action={
            <span className="faint thin" style={{ fontSize: 12 }}>
              Open one to see your path
            </span>
          }
        >
          {stats.recent.length === 0 ? (
            <EmptyState title="No matches yet" hint="Your last few games land here." />
          ) : (
            <div className="col" style={RECENT_BOX}>
              {stats.recent.map((match) => (
                <button
                  key={match.matchId}
                  className="btn btn--ghost btn--sm"
                  onClick={() => openReplay(match)}
                  title={`Replay your path through this ${modeLabel(match.mode)} game`}
                  style={{ justifyContent: 'flex-start', width: '100%', padding: '0 var(--s2)' }}
                >
                  <span
                    className="mono bold"
                    style={{
                      width: 28,
                      flex: 'none',
                      textAlign: 'left',
                      color: match.placement === 1 ? 'var(--green)' : 'var(--text-faint)',
                    }}
                  >
                    {ordinal(match.placement)}
                  </span>
                  <span
                    className="grow truncate"
                    style={{ textAlign: 'left', color: 'var(--text)' }}
                  >
                    {modeLabel(match.mode)}
                  </span>
                  <span className="faint thin mono" style={{ fontSize: 12 }}>
                    {match.players}p
                  </span>
                  <span className="faint thin" style={{ fontSize: 12 }}>
                    {relativeTime(match.playedAt)}
                  </span>
                  <ModeIcon name="chevron" size={13} color="var(--text-faint)" />
                </button>
              ))}
            </div>
          )}
        </Section>

        {/* ------------------------------------------------------- friends */}
        <Section
          title="Friends"
          action={
            <button
              className="btn btn--sm"
              onClick={() => {
                unlockAudio();
                play('click');
                useStore.getState().setTab('friends');
              }}
            >
              All friends
            </button>
          }
        >
          {friends.phase === 'loading' ? (
            <div className="row" style={{ justifyContent: 'center', padding: 'var(--s5) 0' }}>
              <Spinner />
            </div>
          ) : friends.phase === 'error' ? (
            <EmptyState
              title="Could not load your friends"
              hint="Open the friends tab to try again."
            />
          ) : friends.list.length === 0 ? (
            <EmptyState title="No friends yet" hint="Add people and they show up here." />
          ) : (
            <div className="col" style={{ gap: 'var(--s2)' }}>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                  gap: 'var(--s2)',
                }}
              >
                {friends.list.slice(0, FRIENDS_CAP).map((friend) => (
                  <div
                    key={friend.user.id}
                    className="row"
                    title={friend.activity ?? (friend.online ? 'Online' : 'Offline')}
                    style={{ gap: 'var(--s2)', minWidth: 0 }}
                  >
                    {/* The ring is the whole online indicator. A separate dot
                        at this size is one more thing to align and read. */}
                    <Avatar
                      user={friend.user}
                      size={24}
                      ring={friend.online ? 'var(--green)' : undefined}
                    />
                    <span className="truncate" style={{ fontSize: 13 }}>
                      {friend.user.displayName}
                    </span>
                  </div>
                ))}
              </div>
              {friends.list.length > FRIENDS_CAP && (
                <span className="faint thin" style={{ fontSize: 12 }}>
                  and {friends.list.length - FRIENDS_CAP} more
                </span>
              )}
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
        <div
          className="grid"
          style={{
            gridTemplateColumns: 'repeat(auto-fill, minmax(124px, 1fr))',
            gap: 'var(--s1) var(--s2)',
            maxHeight: 104,
            overflowY: 'auto',
          }}
        >
          {stats.achievements.map((achievement) => {
            const unlockedAt = achievement.unlockedAt;
            /* Description and unlock date are the tooltip, not two more lines:
               at this size the grid is a glance, not a reading task. */
            const tip =
              unlockedAt === null
                ? achievement.description
                : `${achievement.description} (got it ${relativeTime(unlockedAt)})`;
            return (
              <div
                key={achievement.id}
                className="row"
                title={tip}
                style={{
                  gap: 'var(--s2)',
                  padding: '3px var(--s2)',
                  borderRadius: 'var(--r-sm)',
                  /* surface-2, not surface: on the light themes surface is all
                     but the page colour and the cards disappear into it. */
                  background: 'var(--surface-2)',
                  opacity: unlockedAt === null ? 0.5 : 1,
                }}
              >
                <ModeIcon
                  name={achievement.icon}
                  size={14}
                  color={unlockedAt === null ? 'var(--text-faint)' : 'var(--green)'}
                />
                <span className="truncate" style={{ fontSize: 12.5 }}>
                  {achievement.name}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      {/* ---------------------------------------------------------- replay */}
      <Modal
        open={openMatch !== null}
        onClose={closeReplay}
        width={560}
        title={
          openMatch
            ? `${modeLabel(openMatch.mode)} · ${relativeTime(openMatch.playedAt)}`
            : 'Your path'
        }
      >
        {view.phase === 'loading' && (
          <div className="row" style={{ justifyContent: 'center', padding: 'var(--s6) 0' }}>
            <Spinner size={20} />
          </div>
        )}
        {view.phase === 'error' && <EmptyState title="Replay unavailable" hint={view.message} />}
        {view.phase === 'ready' && <ReplayBody replay={view.replay} meId={stats.user.id} />}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Replay
 * ------------------------------------------------------------------ */

function ReplayBody({ replay, meId }: { replay: MatchReplay; meId: string }) {
  const mine = replay.paths.filter((p) => p.user.id === meId);
  const me = replay.players.find((p) => p.user.id === meId);

  /* A match can be stored with its summary but no rounds, either abandoned in
     the lobby or trimmed by a retention pass. Without this the modal opens on
     nothing at all. */
  if (replay.rounds.length === 0) {
    return <EmptyState title="Nothing recorded" hint="This match has no rounds saved." />;
  }

  return (
    <div className="col" style={{ gap: 'var(--s4)' }}>
      {me && (
        <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
          <span className="chip">
            {ordinal(me.placement)} of {replay.players.length}
          </span>
          <span className="chip">{me.score.toLocaleString()} points</span>
          <span className="chip">
            {me.wordsFound} found from {me.totalGuesses} guesses
          </span>
        </div>
      )}

      {/* Rounds are numbered by position, not by the stored index: the label
          should read 1..n whatever origin the server counts from. */}
      {replay.rounds.map((round, i) => {
        const path = mine.find((p) => p.round === round.index);
        return (
          <div key={round.index} className="col" style={{ gap: 'var(--s2)' }}>
            <div className="row" style={{ gap: 'var(--s2)' }}>
              <span className="faint thin mono" style={{ fontSize: 12, flex: 'none' }}>
                Round {i + 1}
              </span>
              <span className="bold grow truncate" style={{ fontSize: 15 }}>
                {round.secret}
              </span>
              {path ? (
                <span
                  className={path.found ? 'chip chip--live' : 'chip'}
                  style={{ height: 20, flex: 'none' }}
                >
                  {path.found ? 'found' : `best ${formatRank(path.bestRank)}`}
                </span>
              ) : (
                <span className="faint thin" style={{ fontSize: 12, flex: 'none' }}>
                  no guesses
                </span>
              )}
            </div>
            {path && <PathSteps path={path} />}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The route, in the order it was played.
 *
 * Deliberately NOT sorted by rank. Sorted, this is a scoreboard; in play order
 * it is the actual path, wrong turns included, plus where a hint reset the
 * search and how long each leg took.
 */
function PathSteps({ path }: { path: GuessPath }) {
  return (
    <ol className="col" style={{ gap: 2, listStyle: 'none' }}>
      {path.guesses.map((guess, i) => {
        const color = bandColor(bandForRank(guess.rank));
        return (
          <li
            key={`${i}-${guess.word}`}
            className="row"
            style={{
              gap: 'var(--s2)',
              padding: '2px var(--s2)',
              borderRadius: 'var(--r-sm)',
              /* The band sits on the edge rather than filling the row: twenty
                 filled rows in a modal is a wall of colour, not a path. */
              borderLeft: `3px solid ${color}`,
              background: 'var(--surface-2)',
            }}
          >
            <span className="faint thin mono" style={{ fontSize: 11, width: 20, flex: 'none' }}>
              {i + 1}
            </span>
            <span className="grow truncate" style={{ fontSize: 13.5 }}>
              {guess.word}
            </span>
            {guess.isHint && <Marker icon="spark" label="Hint" color="var(--orange)" />}
            {/* `stolen` means someone else reached this word first, so the
                label reads from that side rather than calling you a thief. */}
            {guess.stolen && (
              <Marker icon="swords" label="Another player had this word first" color="var(--pink)" />
            )}
            <span className="faint thin mono" style={{ fontSize: 11, flex: 'none' }}>
              {formatClock(guess.msIntoRound)}
            </span>
            <span
              className="mono"
              style={{
                fontSize: 13,
                minWidth: 54,
                flex: 'none',
                textAlign: 'right',
                color,
                fontWeight: guess.rank === 1 ? 'var(--w-bold)' : 'var(--w-normal)',
              }}
            >
              {formatRank(guess.rank)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** ModeIcon is aria-hidden, so the meaning has to live on a wrapper. */
function Marker({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <span role="img" aria-label={label} title={label} style={{ display: 'flex', flex: 'none' }}>
      <ModeIcon name={icon} size={12} color={color} />
    </span>
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
