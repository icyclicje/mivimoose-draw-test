import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  bandForRank,
  type GuessPath,
  type MatchReplay,
  type MatchResult,
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
 * Reading a round
 * ------------------------------------------------------------------ */

/**
 * The server stamps foundAt and drops bestRank to 1 in the same step, so either
 * one on its own is enough to call it found. Reading both keeps the check right
 * for a summary row that arrives carrying the rank but not the clock.
 */
function foundTheWord(entry: RoundSummaryEntry): boolean {
  return entry.foundAt !== null || entry.bestRank === 1;
}

/** Whoever got there first by the clock; a find with no clock sorts last. */
function finderOf(round: RoundSummary): RoundSummaryEntry | null {
  let first: RoundSummaryEntry | null = null;
  for (const entry of round.entries) {
    if (!foundTheWord(entry)) continue;
    if (first === null) {
      first = entry;
      continue;
    }
    if ((entry.foundAt ?? Infinity) < (first.foundAt ?? Infinity)) first = entry;
  }
  return first;
}

/** The nearest miss, which is the only story a round nobody solved has. */
function closestOf(round: RoundSummary): RoundSummaryEntry | null {
  let best: RoundSummaryEntry | null = null;
  for (const entry of round.entries) {
    if (entry.bestRank === null) continue;
    if (best === null || entry.bestRank < (best.bestRank ?? Infinity)) best = entry;
  }
  return best;
}

function guessCount(n: number): string {
  return n === 1 ? '1 guess' : `${n} guesses`;
}

/** How somebody landed the word, as one clause: "found it in 2 guesses, 2.9s in". */
function foundClause(entry: RoundSummaryEntry): string {
  const how = entry.guessCount > 0 ? ` in ${guessCount(entry.guessCount)}` : '';
  const when = entry.foundAt !== null ? `, ${formatDuration(entry.foundAt)} in` : '';
  return `found it${how}${when}`;
}

/** The same two facts as a compact column: "2 guesses · 2.9s". */
function foundDetail(entry: RoundSummaryEntry): string {
  const parts: string[] = [];
  if (entry.guessCount > 0) parts.push(guessCount(entry.guessCount));
  if (entry.foundAt !== null) parts.push(formatDuration(entry.foundAt));
  return parts.join(' · ');
}

/**
 * One round in the recap, split in two.
 *
 * The name goes in a column that may truncate; the count or the distance goes
 * in one that may not. Kept as a single sentence it was the number that got
 * cut off, which is the only part of the row worth reading.
 */
interface RoundRecap {
  who: string;
  detail: string;
  found: boolean;
}

function roundRecap(round: RoundSummary): RoundRecap {
  const finder = finderOf(round);
  if (finder) {
    const others = round.entries.filter(foundTheWord).length - 1;
    return {
      who: `${finder.displayName} found it${others > 0 ? ` · ${others} more did too` : ''}`,
      detail: foundDetail(finder),
      found: true,
    };
  }
  const closest = closestOf(round);
  return closest
    ? { who: `${closest.displayName} was closest`, detail: formatAway(closest.bestRank), found: false }
    : { who: 'nobody guessed', detail: '', found: false };
}

/* ------------------------------------------------------------------ *
 * Verdict: why this result happened
 * ------------------------------------------------------------------ */

interface Verdict {
  icon: string;
  color: string;
  /** The result in one sentence, drawn from the rounds rather than the score. */
  line: string;
  /** The second sentence: the margin, or what settled a level score. */
  note: string | null;
}

/** The round a player was knocked out in, or null if they lasted the match. */
function eliminatedIn(rounds: RoundSummary[], playerId: string): number | null {
  return rounds.find((r) => r.eliminated.includes(playerId))?.round ?? null;
}

/**
 * What actually put the leader above second place, when it was not points.
 *
 * The server sorts elimination by survival first, then everything by score and
 * then by words found. A level score with no explanation is the one result that
 * reads as a bug, so name the rule that broke it.
 */
function settlementNote(
  result: MatchResult,
  leader: MatchResultEntry,
  runnerUp: MatchResultEntry | null,
): string | null {
  // A co-op team shares one score, so a level score there is the design, not a tie.
  if (!runnerUp || result.mode === 'coop') return null;

  if (result.mode === 'elimination') {
    const out = eliminatedIn(result.rounds, runnerUp.playerId);
    if (out !== null && eliminatedIn(result.rounds, leader.playerId) === null) {
      return `${leader.displayName} was still in at the end; ${runnerUp.displayName} went out in round ${out}.`;
    }
  }

  if (leader.score !== runnerUp.score) return null;
  if (leader.wordsFound !== runnerUp.wordsFound) {
    return `Level on ${leader.score.toLocaleString()} points, so words found settled it: ${leader.wordsFound} to ${runnerUp.wordsFound}.`;
  }
  return `Level on ${leader.score.toLocaleString()} points and ${leader.wordsFound} words found. That is as close to a draw as the scoring gets.`;
}

/** How close the runner-up got, for the one-word modes where that is the whole match. */
function chaseNote(round: RoundSummary, runnerUp: MatchResultEntry | null): string | null {
  if (!runnerUp) return null;
  const entry = round.entries.find((e) => e.playerId === runnerUp.playerId);
  if (!entry) return null;
  if (foundTheWord(entry)) {
    return entry.foundAt !== null
      ? `${runnerUp.displayName} found it too, ${formatDuration(entry.foundAt)} in.`
      : `${runnerUp.displayName} found it too.`;
  }
  if (entry.bestRank === null) return `${runnerUp.displayName} never got a guess in.`;
  const after = entry.guessCount > 0 ? ` after ${guessCount(entry.guessCount)}` : '';
  return `${runnerUp.displayName} stopped ${formatAway(entry.bestRank)}${after}.`;
}

/** The points gap, so a win reads as comfortable or narrow rather than just first. */
function marginNote(
  result: MatchResult,
  leader: MatchResultEntry,
  runnerUp: MatchResultEntry | null,
): string | null {
  if (!runnerUp) return null;
  const gap = leader.score - runnerUp.score;
  if (gap <= 0) return null;
  // Naming the runner-up's haul as well is what stops "took 2 of 3" reading as
  // a contradiction when they actually found more words and still lost.
  const took =
    result.rounds.length > 1
      ? `, who took ${runnerUp.wordsFound} of ${result.rounds.length}`
      : '';
  return `${gap.toLocaleString()} points clear of ${runnerUp.displayName}${took}.`;
}

/**
 * Two short sentences at most.
 *
 * A third is another wrapped line on a screen that has to hold the standings
 * and the round list inside 680px, and the first two are always the ones that
 * explain the result rather than decorate it.
 */
function joinNotes(...parts: (string | null)[]): string | null {
  const kept = parts.filter((part): part is string => part !== null).slice(0, 2);
  return kept.length > 0 ? kept.join(' ') : null;
}

/**
 * One sentence saying why the standings look the way they do.
 *
 * Assembled from result.rounds and result.entries: the payload carries no
 * post-match narrative, and a placement on its own explains nothing.
 */
function buildVerdict(result: MatchResult): Verdict {
  const rounds = result.rounds;
  const leader = result.entries.find((e) => e.placement === 1) ?? result.entries[0] ?? null;

  if (rounds.length === 0 || !leader) {
    return {
      icon: 'info',
      color: 'var(--text-faint)',
      line: 'The match ended before a round finished',
      note: null,
    };
  }

  const runnerUp = result.entries.find((e) => e.placement === 2) ?? null;
  const settled = settlementNote(result, leader, runnerUp);

  // One word: the match is that round, so the verdict is that round's story.
  if (rounds.length === 1) {
    const round = rounds[0];
    const finder = finderOf(round);
    const closest = finder ? null : closestOf(round);
    // Hints and guess count are priced in, so the fastest find does not always
    // top the table. Left unsaid, that reads as the screen contradicting itself.
    const upset =
      finder && finder.playerId !== leader.playerId
        ? `${leader.displayName} still finished first on points.`
        : null;
    // The chase line would repeat the headline word for word when the runner-up
    // is the player the headline already names.
    const named = finder ?? closest;
    const chase =
      runnerUp !== null && named !== null && named.playerId === runnerUp.playerId
        ? null
        : chaseNote(round, runnerUp);
    // A level score comes first: it is the one thing on this screen a player can
    // see for themselves and misread as a bug.
    const note = joinNotes(settled, upset, chase ?? marginNote(result, leader, runnerUp));
    if (finder) {
      return {
        icon: 'target',
        color: 'var(--green)',
        line: `${finder.displayName} ${foundClause(finder)}`,
        note,
      };
    }
    return {
      icon: 'snowflake',
      color: 'var(--orange)',
      line: closest
        ? `Nobody found it. ${closest.displayName} was closest at ${formatAway(closest.bestRank)}`
        : 'Nobody found it, and nobody got a guess in',
      note,
    };
  }

  // Several words: the decider is how many of them the leader actually took.
  const note = joinNotes(settled, marginNote(result, leader, runnerUp));
  if (leader.wordsFound > 0) {
    return {
      icon: 'trophy',
      color: 'var(--green)',
      line: `${leader.displayName} took ${leader.wordsFound} of ${rounds.length} words`,
      note,
    };
  }

  // Nothing found, so the lead came from placements: rank order still scores.
  const closestRounds = rounds.filter((r) =>
    r.entries.some((e) => e.playerId === leader.playerId && e.placement === 1),
  ).length;
  return {
    icon: 'snowflake',
    color: 'var(--orange)',
    line:
      closestRounds > 0
        ? `${leader.displayName} found none of the ${rounds.length} words, but was closest in ${closestRounds}`
        : `${leader.displayName} won on points without finding a word`,
    note,
  };
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
  // The summary row carries the timing, the path carries the flag, and either
  // can be missing on its own: an eliminated player drops out of later summaries
  // while their guesses stay in the replay.
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

  // The line that says why. Derived once, since a result never changes after it lands.
  const verdict = useMemo(() => (result ? buildVerdict(result) : null), [result]);

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
          this screen is a click away, so this line is all that must be read. */}
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
              disabled rather than hidden. A vanished button just reads as a
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

      {/* ---------------------------------------------------------- verdict
          The scores say who; this says why. It sits above the standings
          because it is the sentence somebody would say out loud about the
          match, and the table underneath is only the evidence for it. */}
      {verdict && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06 }}
          className="panel row"
          style={{
            gap: 'var(--s2)',
            padding: 'var(--s2) var(--s3)',
            alignItems: verdict.note ? 'flex-start' : 'center',
          }}
        >
          <span className="row" style={{ flex: 'none', paddingTop: verdict.note ? 3 : 0 }}>
            <ModeIcon name={verdict.icon} size={15} color={verdict.color} />
          </span>
          <div className="col grow" style={{ gap: 1 }}>
            <span className="bold" style={{ fontSize: 14.5 }}>
              {verdict.line}
            </span>
            {verdict.note && (
              <span className="dim thin" style={{ fontSize: 12.5 }}>
                {verdict.note}
              </span>
            )}
          </div>
        </motion.div>
      )}

      {/* -------------------------------------------------------- standings */}
      <Section
        title="Standings"
        action={<span className="faint thin">pick a player to see their path</span>}
      >
        {/* Capped rather than left to grow: a full lobby must not push the
            round list off a 680px screen. */}
        <div className="col" style={{ gap: 'var(--s1)', maxHeight: 190, overflowY: 'auto' }}>
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

      {/* ----------------------------------------------------------- rounds
          Today's daily played together is stored as an ordinary co-op match,
          so the recorded mode on its own would label it "Co-op" and lose what
          it actually was. The lobby and the board both name it, and the screen
          that closes the same room has to agree with them. */}
      <Section
        title="Rounds"
        action={
          <span className="chip chip--brand">
            {room.dailyCoop ? 'Daily co-op' : modeLabel(result.mode)}
          </span>
        }
      >
        {/* Marathon runs to 20 rounds, so this scrolls inside itself. */}
        <div className="col" style={{ gap: 'var(--s1)', maxHeight: 132, overflowY: 'auto' }}>
          {result.rounds.length === 0 ? (
            <span className="faint thin" style={{ fontSize: 13 }}>
              the match ended before a round finished
            </span>
          ) : (
            result.rounds.map((round) => {
              // Who took it and how cheaply, or who came nearest and by how far.
              const recap = roundRecap(round);
              const recapTitle = recap.detail ? `${recap.who}, ${recap.detail}` : recap.who;
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
                    title={recapTitle}
                  >
                    {recap.who}
                  </span>

                  {/* The count or the distance, in its own column so a long name
                      can never eat the only number on the row. */}
                  {recap.detail !== '' && (
                    <span
                      className="mono"
                      style={{
                        flex: 'none',
                        fontSize: 12,
                        color: recap.found ? 'var(--green)' : 'var(--text-faint)',
                      }}
                    >
                      {recap.detail}
                    </span>
                  )}

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
        title={openEntry ? `Every guess by ${openEntry.displayName}` : 'Every guess'}
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
