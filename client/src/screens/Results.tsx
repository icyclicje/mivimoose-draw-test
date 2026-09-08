import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  bandForRank,
  type GuessPath,
  type MatchReplay,
  type MatchResultEntry,
  type RoomState,
  type RoundSummary,
  type RoundSummaryEntry,
} from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { Avatar, EmptyState, Modal, Section, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import {
  bandColor,
  formatAway,
  formatClock,
  formatDuration,
  formatRank,
  modeLabel,
  ordinal,
} from '../lib/format';
import { play, unlockAudio } from '../lib/sound';
import { useStore } from '../lib/store';

/** Elo only exists on ranked matches, so both ends can be null. */
function ratingDelta(entry: MatchResultEntry): number | null {
  return entry.ratingAfter !== null && entry.ratingBefore !== null
    ? entry.ratingAfter - entry.ratingBefore
    : null;
}

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function deltaColor(n: number): string {
  return n >= 0 ? 'var(--green)' : 'var(--pink)';
}

/* ------------------------------------------------------------------ *
 * One round of one player's path
 * ------------------------------------------------------------------ */

/**
 * The route somebody actually took to a word, in the order they played it.
 *
 * Sorting by rank would be tidier and useless: the point is watching them
 * circle in, double back, and either land it or run out of time.
 */
function RoundPath({
  round,
  path,
  entry,
  eliminated,
}: {
  round: RoundSummary;
  path: GuessPath | undefined;
  entry: RoundSummaryEntry | undefined;
  eliminated: boolean;
}) {
  const foundAt = entry?.foundAt ?? null;
  const bestRank = path?.bestRank ?? entry?.bestRank ?? null;
  // The summary row carries the timing, the path carries the flag. Reading only
  // one leaves a hole: a player with no summary row still has a path, and a
  // co-op find lands on the team rather than on a clock.
  const found = foundAt !== null || (path?.found ?? false);
  const outcome = found
    ? foundAt !== null
      ? `found in ${formatDuration(foundAt)}`
      : 'found it'
    : formatAway(bestRank);

  return (
    <div className="col" style={{ gap: 'var(--s1)' }}>
      <div className="row" style={{ gap: 'var(--s2)' }}>
        <span className="mono faint" style={{ width: 14, flex: 'none', fontSize: 12 }}>
          {round.round}
        </span>
        <span className="bold truncate" style={{ fontSize: 15 }}>
          {round.secret}
        </span>

        <span className="grow" />

        {eliminated && (
          <span className="mono" style={{ flex: 'none', fontSize: 11.5, color: 'var(--pink)' }}>
            out
          </span>
        )}

        {/* Whether they found it and how long it took, or how close they got. */}
        <span
          className="mono"
          style={{
            flex: 'none',
            fontSize: 12,
            color: found ? 'var(--green)' : 'var(--text-faint)',
          }}
        >
          {outcome}
        </span>

        {entry && entry.points > 0 && (
          <span
            className="mono bold"
            style={{ flex: 'none', fontSize: 12.5, minWidth: 38, textAlign: 'right' }}
          >
            +{entry.points}
          </span>
        )}
      </div>

      {path && path.guesses.length > 0 ? (
        <div className="col" style={{ gap: 2 }}>
          {path.guesses.map((guess, i) => (
            <div
              key={`${guess.word}-${i}`}
              className="row"
              style={{
                gap: 'var(--s2)',
                padding: '2px var(--s2)',
                borderRadius: 'var(--r-sm)',
                background: 'var(--surface-2)',
              }}
            >
              <span
                className="mono faint"
                style={{ width: 16, flex: 'none', fontSize: 11, textAlign: 'right' }}
              >
                {i + 1}
              </span>

              <span className="truncate" style={{ fontSize: 13.5, flex: '0 1 auto' }}>
                {guess.word}
              </span>

              {guess.isHint && (
                <span className="chip chip--accent" style={{ height: 17, fontSize: 10, flex: 'none' }}>
                  hint
                </span>
              )}
              {guess.stolen && (
                <span className="chip chip--warn" style={{ height: 17, fontSize: 10, flex: 'none' }}>
                  stolen
                </span>
              )}

              <span className="grow" />

              <span className="mono faint" style={{ flex: 'none', fontSize: 11 }}>
                {formatClock(guess.msIntoRound)}
              </span>

              {/* The rank carries the band colour, the same scale the board uses. */}
              <span
                className="mono bold"
                style={{
                  flex: 'none',
                  fontSize: 12.5,
                  minWidth: 54,
                  textAlign: 'right',
                  color: bandColor(bandForRank(guess.rank)),
                }}
              >
                {formatRank(guess.rank)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="faint thin" style={{ fontSize: 12.5, paddingLeft: 22 }}>
          no guesses this round
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export function Results({ room }: { room: RoomState }) {
  const user = useStore((s) => s.user);
  const rematch = useStore((s) => s.rematch);
  const leaveRoom = useStore((s) => s.leaveRoom);

  // All hooks sit above the early return so the hook order never changes.
  const [replay, setReplay] = useState<MatchReplay | null>(null);
  const [replayFailed, setReplayFailed] = useState(false);
  /** False until the first path is opened; nothing is fetched before that. */
  const [wantReplay, setWantReplay] = useState(false);
  /** Bumped by Try again, and the only thing that makes the load run twice. */
  const [attempt, setAttempt] = useState(0);
  /** Player whose path is open; null when the modal is closed. */
  const [pathOf, setPathOf] = useState<string | null>(null);
  const sounded = useRef(false);

  const result = room.result;
  const matchId = result?.matchId ?? null;
  const mine = result?.entries.find((e) => e.playerId === user?.id) ?? null;
  const placedFirst = mine?.placement === 1;

  // Win or lose, once, when the result first lands.
  useEffect(() => {
    if (!result || sounded.current) return;
    sounded.current = true;
    play(placedFirst ? 'win' : 'lose');
  }, [result, placedFirst]);

  /*
   * One request per match, held for the life of the screen so switching player
   * in the modal never goes back to the network.
   *
   * The deps are only the three things that should ever start a fetch. Tracking
   * the request's own status here instead is what hung an earlier version:
   * setting it re-ran the effect, the cleanup cancelled the in-flight promise,
   * and the modal sat on the spinner for ever.
   */
  useEffect(() => {
    if (!wantReplay || !matchId) return;
    let cancelled = false;
    setReplayFailed(false);
    api.replay(matchId).then(
      (data) => {
        if (!cancelled) setReplay(data);
      },
      () => {
        if (!cancelled) setReplayFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [wantReplay, matchId, attempt]);

  // Paths arrive as a flat list of player-and-round pairs; the modal reads them
  // one cell at a time.
  const pathIndex = useMemo(() => {
    const map = new Map<string, GuessPath>();
    for (const path of replay?.paths ?? []) map.set(`${path.user.id}:${path.round}`, path);
    return map;
  }, [replay]);

  const openPath = useCallback((playerId: string) => {
    unlockAudio();
    play('click');
    setWantReplay(true);
    setPathOf(playerId);
  }, []);

  const switchPath = useCallback((playerId: string) => {
    play('click');
    setPathOf(playerId);
  }, []);

  const closePath = useCallback(() => setPathOf(null), []);

  const retry = useCallback(() => {
    play('click');
    setAttempt((n) => n + 1);
  }, []);

  if (!result) {
    return (
      <div className="page">
        <EmptyState icon={<Spinner size={20} />} title="Tallying up" hint="Scoring the last round." />
      </div>
    );
  }

  // By placement rather than array order, so the headline survives the server
  // ever changing how it sorts the list.
  const winner = result.entries.find((e) => e.placement === 1) ?? result.entries[0];
  const isHost = room.hostId === user?.id;
  const myDelta = mine ? ratingDelta(mine) : null;
  const openEntry = result.entries.find((e) => e.playerId === pathOf) ?? null;
  const openPlayer = replay?.players.find((p) => p.user.id === pathOf) ?? null;
  const loadingReplay = wantReplay && !replay && !replayFailed;

  return (
    <div className="page" style={{ gap: 'var(--s4)' }}>
      {/* ---------------------------------------------------------- headline
          Who won, where you landed, and the two ways out. Everything else on
          this screen is a click away — this line is all that must be read. */}
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="panel row row--wrap"
        style={{ gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}
      >
        {winner && (
          <Avatar user={{ displayName: winner.displayName, avatarUrl: winner.avatarUrl }} size={34} />
        )}

        <div className="grow row row--wrap" style={{ gap: 'var(--s2)', minWidth: 180 }}>
          <h2 className="truncate">
            {winner ? (placedFirst ? 'You win' : `${winner.displayName} wins`) : 'No winner'}
          </h2>

          <span className="dim" style={{ fontSize: 13 }}>
            {mine
              ? placedFirst
                ? `${mine.score.toLocaleString()} pts`
                : `you finished ${ordinal(mine.placement)} · ${mine.score.toLocaleString()} pts`
              : 'you watched this one'}
          </span>

          {myDelta !== null && (
            <span className="mono" style={{ fontSize: 13, color: deltaColor(myDelta) }}>
              {signed(myDelta)} elo
            </span>
          )}
          {mine && mine.xpGained > 0 && (
            <span className="mono faint" style={{ fontSize: 13 }}>
              +{mine.xpGained} xp
            </span>
          )}
        </div>

        <div className="row" style={{ gap: 'var(--s2)', flex: 'none' }}>
          {/* The server rejects a rematch from anyone but the host, so it is
              disabled rather than hidden — a vanished button just reads as a
              bug to everyone who isn't hosting. */}
          <button
            className="btn btn--primary"
            onClick={() => {
              unlockAudio();
              play('click');
              rematch();
            }}
            disabled={!isHost}
            title={isHost ? undefined : 'only the host can call a rematch'}
          >
            <ModeIcon name="bolt" size={15} />
            Rematch
          </button>
          <button
            className="btn"
            onClick={() => {
              unlockAudio();
              play('click');
              leaveRoom();
            }}
          >
            Back to menu
          </button>
        </div>
      </motion.header>

      {/* -------------------------------------------------------- standings */}
      <Section
        title="Standings"
        action={<span className="faint thin">pick a player to see their path</span>}
      >
        {/* Capped rather than left to grow: a full lobby must not push the
            round list off a 680px screen. */}
        <div className="col" style={{ gap: 'var(--s1)', maxHeight: 216, overflowY: 'auto' }}>
          {result.entries.map((entry, i) => {
            const delta = ratingDelta(entry);
            const isMe = entry.playerId === user?.id;
            return (
              <motion.button
                key={entry.playerId}
                type="button"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.2) }}
                onClick={() => openPath(entry.playerId)}
                title={`see how ${entry.displayName} got there`}
                className="row"
                style={{
                  width: '100%',
                  flex: 'none',
                  gap: 'var(--s2)',
                  padding: '5px var(--s2)',
                  borderRadius: 'var(--r-sm)',
                  textAlign: 'left',
                  background: isMe ? 'var(--accent-soft)' : 'var(--surface-2)',
                  border: `1px solid ${isMe ? 'var(--accent)' : 'var(--line)'}`,
                }}
              >
                <span
                  className="mono bold"
                  style={{
                    width: 16,
                    flex: 'none',
                    fontSize: 13,
                    color: entry.placement === 1 ? 'var(--text)' : 'var(--text-faint)',
                  }}
                >
                  {entry.placement}
                </span>

                <Avatar
                  user={{ displayName: entry.displayName, avatarUrl: entry.avatarUrl }}
                  size={24}
                />

                <span className="grow truncate" style={{ fontSize: 14 }}>
                  {entry.displayName}
                </span>

                {entry.xpGained > 0 && (
                  <span className="mono faint thin" style={{ fontSize: 11.5, flex: 'none' }}>
                    +{entry.xpGained} xp
                  </span>
                )}

                {delta !== null && (
                  <span
                    className="mono"
                    style={{ fontSize: 12.5, flex: 'none', color: deltaColor(delta) }}
                  >
                    {signed(delta)}
                  </span>
                )}

                <span
                  className="mono bold"
                  style={{ minWidth: 52, flex: 'none', textAlign: 'right', fontSize: 14 }}
                >
                  {entry.score.toLocaleString()}
                </span>

                <ModeIcon name="route" size={14} color="var(--text-faint)" />
              </motion.button>
            );
          })}
        </div>
      </Section>

      {/* ----------------------------------------------------------- rounds */}
      <Section
        title="Rounds"
        action={<span className="chip chip--brand">{modeLabel(result.mode)}</span>}
      >
        {/* Marathon runs to 20 rounds, so this scrolls inside itself. */}
        <div className="col" style={{ gap: 'var(--s1)', maxHeight: 152, overflowY: 'auto' }}>
          {result.rounds.length === 0 ? (
            <span className="faint thin" style={{ fontSize: 13 }}>
              the match ended before a round finished
            </span>
          ) : (
            result.rounds.map((round) => {
              const solvers = round.entries.filter((e) => e.foundAt !== null);
              const solvedBy = solvers.length
                ? `found by ${solvers.map((s) => s.displayName).join(', ')}`
                : 'nobody found it';
              return (
                <div
                  key={round.round}
                  className="row"
                  style={{
                    flex: 'none',
                    gap: 'var(--s2)',
                    padding: '4px var(--s2)',
                    borderRadius: 'var(--r-sm)',
                    background: 'var(--surface-2)',
                  }}
                >
                  <span className="mono faint" style={{ width: 14, flex: 'none', fontSize: 12 }}>
                    {round.round}
                  </span>

                  <span className="bold truncate" style={{ minWidth: 80, fontSize: 14 }}>
                    {round.secret}
                  </span>

                  <span
                    className="grow dim thin truncate"
                    style={{ fontSize: 12.5 }}
                    title={solvedBy}
                  >
                    {solvedBy}
                  </span>

                  {round.eliminated.length > 0 && (
                    <span
                      className="mono"
                      style={{ fontSize: 11.5, flex: 'none', color: 'var(--pink)' }}
                    >
                      {round.eliminated.length} out
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Section>

      {/* ------------------------------------------------------------ paths */}
      <Modal
        open={pathOf !== null}
        title={openEntry ? `${openEntry.displayName} — every guess` : 'Every guess'}
        onClose={closePath}
        width={560}
      >
        <div className="col" style={{ gap: 'var(--s3)' }}>
          {/* Switching player from in here saves closing the modal and aiming
              at another row, and the replay is already in memory either way. */}
          {pathOf !== null && result.entries.length > 1 && (
            <Segmented
              value={pathOf}
              onChange={switchPath}
              options={result.entries.map((e) => ({ value: e.playerId, label: e.displayName }))}
            />
          )}

          {openEntry && (
            <div className="row row--wrap" style={{ gap: 'var(--s2)' }}>
              <span className="dim" style={{ fontSize: 13 }}>
                {ordinal(openEntry.placement)} · {openEntry.score.toLocaleString()} pts
              </span>
              <span className="faint thin" style={{ fontSize: 12.5 }}>
                {openEntry.wordsFound} of {result.rounds.length} found ·{' '}
                {openPlayer?.totalGuesses ?? openEntry.totalGuesses} guesses
              </span>
            </div>
          )}

          {loadingReplay && (
            <EmptyState
              icon={<Spinner size={18} />}
              title="Loading paths"
              hint="Getting every guess from the match."
            />
          )}

          {replayFailed && (
            <div className="col" style={{ gap: 'var(--s2)', alignItems: 'center' }}>
              <EmptyState title="Could not load the paths" hint="The replay did not come back." />
              <button className="btn btn--sm" onClick={retry}>
                Try again
              </button>
            </div>
          )}

          {replay && pathOf !== null && (
            <div className="col" style={{ gap: 'var(--s4)' }}>
              {result.rounds.length === 0 ? (
                <span className="faint thin" style={{ fontSize: 13 }}>
                  no rounds were finished, so there is no path to show
                </span>
              ) : (
                result.rounds.map((round) => (
                  <RoundPath
                    key={round.round}
                    round={round}
                    path={pathIndex.get(`${pathOf}:${round.round}`)}
                    entry={round.entries.find((e) => e.playerId === pathOf)}
                    eliminated={round.eliminated.includes(pathOf)}
                  />
                ))
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
