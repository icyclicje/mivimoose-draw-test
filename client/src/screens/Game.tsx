import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  bandForRank,
  type GuessResult,
  type RoomState,
  type RoundSummary,
} from '@mivimoose/shared';
import { Chat } from '../components/Chat';
import { Countdown, GuessList } from '../components/game';
import { Logo } from '../components/Logo';
import { ModeIcon } from '../components/ModeIcon';
import { StatusOverlay } from '../components/StatusOverlay';
import { Avatar, Spinner } from '../components/ui';
import {
  bandColor,
  cx,
  formatAway,
  formatDuration,
  formatRank,
  modeLabel,
  ordinal,
} from '../lib/format';
import { play, playRank, unlockAudio } from '../lib/sound';
import { useCountdown } from '../hooks/useCountdown';
import { useStore } from '../lib/store';

/**
 * Click sound plus the audio unlock. A match can begin before this player has
 * pressed anything at all, because quickplay drops you straight onto the board.
 * So every button here has to be able to be the gesture that opens audio.
 */
function tap(): void {
  unlockAudio();
  play('click');
}

/** "Ada Lovelace" → "Ada". Unchanged for a one-word name. */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Seconds per round, said the way a person would say it.
 *
 * The setting is stored in seconds and the common values are whole minutes, so
 * printing it raw turns a three minute duel into "180s a round", which reads as
 * a stopwatch reading rather than a length of time.
 */
function roundLength(seconds: number): string {
  if (seconds <= 0) return 'No time limit';
  if (seconds < 60) return `${seconds}s a round`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (rest === 0) return `${minutes} min a round`;
  return `${minutes}m ${rest}s a round`;
}

/**
 * How the roster animates a change of order.
 *
 * A spring rather than a duration: an overtake is one pill physically passing
 * another, and it should settle rather than stop. Module level so the object is
 * not rebuilt on every room patch, of which there are several a second.
 */
const ROSTER_SPRING = { type: 'spring', stiffness: 380, damping: 34 } as const;

/**
 * Was this rejection somebody beating you to the word?
 *
 * The store keeps a rejection as prose rather than as a GuessErrorCode, so the
 * one rejection that is not a mistake has to be recognised from the text. The
 * server writes `already-guessed` under lockClaimedWords as "<Name> guessed
 * this word before you.", so a message that both names another player in the
 * room and says they were first is that case, and earns the softer cue.
 */
function beatenToIt(message: string, rivals: string[]): boolean {
  if (!/\bbefore you\b/i.test(message)) return false;
  return rivals.some((name) => name.length > 0 && message.includes(name));
}

export function Game({ room }: { room: RoomState }) {
  const user = useStore((s) => s.user);
  const clockOffset = useStore((s) => s.clockOffset);
  const guess = useStore((s) => s.guess);
  const hint = useStore((s) => s.hint);
  const giveUp = useStore((s) => s.giveUp);
  const guessError = useStore((s) => s.guessError);
  const clearGuessError = useStore((s) => s.clearGuessError);
  const latestGuessId = useStore((s) => s.latestGuessId);
  const latestGuess = useStore((s) => s.latestGuess);
  // Bumped on every submission, so replaying a word the board already holds
  // still re-flashes the pinned row.
  const guessSeq = useStore((s) => s.guessSeq);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const connected = useStore((s) => s.connected);

  const [word, setWord] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [hinting, setHinting] = useState(false);
  // Open from the start. A shut drawer with a one-line preview asks people to
  // go and find the conversation before they can join it, and a match is short
  // enough that almost nobody does. It still folds away for anyone who wants
  // the board on its own.
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [watching, setWatching] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const me = room.players.find((p) => p.user.id === user?.id);
  const isSpectator = !me;
  const remaining = useCountdown(room.deadline, clockOffset);

  const nameFor = useMemo(() => {
    const names = new Map(room.players.map((p) => [p.user.id, p.user.displayName]));
    return (id: string) => names.get(id) ?? 'Someone';
  }, [room.players]);

  // Everyone else at the table, by name. Used to tell "somebody got there
  // first" apart from an ordinary rejection.
  const rivalNames = useMemo(
    () => room.players.filter((p) => p.user.id !== user?.id).map((p) => p.user.displayName),
    [room.players, user?.id],
  );

  /**
   * Which rooms get the short rules strip.
   *
   * Quick match is a fixed configuration nobody chose, so itemising it presents
   * a default as though it were a decision. A duel can be hosted from a lobby,
   * but it is two people racing for one word, and the only things that bound
   * that race are the number of rounds, the length of one, and whether it
   * counts. Difficulty and the rest stay true, they are just not what you are
   * reading the board for. Every other mode is a table somebody assembled, and
   * there the fuller list is a summary of the choices they made.
   */
  const simpleRules = room.autoStart || room.mode === 'duel';

  /**
   * How much of a roster pill survives as the table fills.
   *
   * The distance is the number people actually compare, so it is never the
   * thing that gets cut. The name gives way instead. The strip scrolls, but a
   * lobby you have to drag sideways through is worse than short names.
   */
  const rosterName: 'full' | 'first' | 'none' =
    room.players.length <= 4 ? 'full' : room.players.length <= 7 ? 'first' : 'none';

  // Once you have found the word your round is over and the server starts
  // sending the other boards down. Watching is one player at a time rather than
  // a merged feed: whose guesses you are reading has to stay obvious.
  const canWatch = me?.status === 'found';
  const others = useMemo(
    () => room.players.filter((p) => p.user.id !== user?.id && p.guesses !== undefined),
    [room.players, user?.id],
  );
  const watched = canWatch ? (others.find((p) => p.user.id === watching) ?? null) : null;
  const guesses: GuessResult[] = watched?.guesses ?? me?.guesses ?? [];
  // Both the tab strip and the line naming whose list you are reading only
  // mean anything once there is more than one board to be on. Rendering the
  // line the rest of the time spends a row of a short screen on the words
  // "your board" directly above your board.
  const showBoards = canWatch && others.length > 0;

  /**
   * Closest first, so the leader is always the leftmost pill.
   *
   * Score is the right order for the results screen, but mid-round it barely
   * moves: it settles when a round ends, so a strip sorted on it sits still
   * through the whole hunt. Best rank is the number that changes while people
   * are guessing, and ordering on it turns an overtake into a swap you can
   * watch happen. Players with nothing on the board yet hold the far end
   * rather than the front, because a missing rank is not a good one.
   */
  const standings = useMemo(
    () =>
      [...room.players].sort((a, b) => {
        const aBest = a.bestRank ?? Infinity;
        const bBest = b.bestRank ?? Infinity;
        if (aBest !== bBest) return aBest - bBest;
        // Before anyone has guessed, every player ties on Infinity. The server
        // makes no promise about player order between patches, so without a
        // last resort of its own the strip would reshuffle itself on each one.
        if (b.score !== a.score) return b.score - a.score;
        return a.user.id.localeCompare(b.user.id);
      }),
    [room.players],
  );

  const myTurn = !room.activePlayerId || room.activePlayerId === user?.id;
  // Written as an explicit null check so the value is a boolean rather than
  // `number | null | undefined` leaking into the effect dependencies.
  const frozen = me?.frozenUntil != null && me.frozenUntil > Date.now() + clockOffset;
  // A spectator has no budget, so showing them one was showing them somebody
  // else's number.
  const guessesLeft =
    me && room.settings.guessLimit > 0 ? room.settings.guessLimit - me.guessCount : null;

  const lastEntry = room.feed[room.feed.length - 1];

  useEffect(() => {
    if (room.phase === 'playing' && myTurn && !frozen) inputRef.current?.focus();
  }, [room.phase, room.round, myTurn, frozen]);

  // A new round puts you back in the hunt, so drop back to your own board.
  useEffect(() => {
    setWatching(null);
  }, [room.round]);

  /**
   * One cue per phase transition.
   *
   * Room patches arrive several times a second, so the sound hangs on the
   * marker rather than on the render. A ref is enough because App deliberately
   * does not key this screen on phase: it stays mounted across countdown,
   * playing and roundEnd, and StrictMode re-runs the effect on the same
   * instance.
   */
  const cuedPhase = useRef<string | null>(null);
  useEffect(() => {
    const key = `${room.code}:${room.round}:${room.phase}`;
    if (cuedPhase.current === key) return;
    cuedPhase.current = key;
    // Silent unless a gesture has already unlocked audio, which is what we want:
    // nothing on this screen should be the thing that starts making noise.
    if (room.phase === 'countdown') play('start');
    else if (room.phase === 'roundEnd') play('roundEnd');
  }, [room.phase, room.code, room.round]);

  const canGuess =
    room.phase === 'playing' &&
    !isSpectator &&
    me?.status !== 'found' &&
    me?.status !== 'eliminated' &&
    myTurn &&
    !frozen;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = word.trim();
    if (!value || submitting) return;
    // Submitting is usually the first gesture on this screen, so it is where
    // audio can legally start. Enter counts as one too.
    unlockAudio();
    setSubmitting(true);
    try {
      const result = await guess(value);
      // The rank cue carries the same information as the bar, in a channel you
      // do not have to be looking at.
      if (result) {
        playRank(result.rank);
        setWord('');
      } else {
        // The rejection text only lands in the store once the ack resolves, so
        // it is read back rather than taken from the render closure, which is
        // still a submission behind. Losing a word to somebody is part of the
        // game rather than a mistake, so it gets its own softer cue.
        const message = useStore.getState().guessError ?? '';
        play(beatenToIt(message, rivalNames) ? 'taken' : 'reject');
      }
    } finally {
      // In a finally block so a throw anywhere above cannot leave the input
      // read-only and the button dead for the rest of the round.
      setSubmitting(false);
      // Enter always leaves you ready to type the next word: accepted, the box
      // is empty and focused; rejected, the word is still there to edit.
      inputRef.current?.focus();
    }
  }

  // Hints are a limited resource and the request can take a moment, so the
  // button has to stay shut until the server has answered. Without the guard a
  // second click spends a second hint.
  async function askHint() {
    if (hinting || !canGuess) return;
    tap();
    setHinting(true);
    try {
      await hint();
    } finally {
      setHinting(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="page page--board">
      {/* ------------------------------------------------------- status
          Two groups. On the left, the shape of the match. On the right, what is
          happening in it at this second. */}
      <div className="statusbar">
        {/* Somebody turned this on deliberately, and it is a fact about the
            word you are hunting rather than lobby metadata, so it carries
            weight and a colour instead of sitting with the faint text. It
            survives the short strip below for the same reason: it describes the
            answer, not the settings. */}
        {room.secretLength !== null && (
          <span
            className="mono bold"
            style={{ fontSize: 15, color: 'var(--accent)' }}
            title="Letters in the answer"
          >
            {room.secretLength} {room.secretLength === 1 ? 'letter' : 'letters'}
          </span>
        )}

        {simpleRules ? (
          <>
            <span className="mono" style={{ fontSize: 13 }}>
              {room.totalRounds > 1 ? `Round ${room.round}/${room.totalRounds}` : 'One round'}
            </span>
            <span className="mono" style={{ fontSize: 13 }}>
              {roundLength(room.settings.roundSeconds)}
            </span>
            {/* Stated either way. Whether this one moves your rating is a
                question with two answers, and printing only the yes leaves the
                no to be inferred from an absence. */}
            {room.settings.ranked ? (
              <span className="chip chip--accent">ranked</span>
            ) : (
              <span className="faint" style={{ fontSize: 12.5 }}>
                casual
              </span>
            )}
          </>
        ) : (
          <>
            {/* Today's daily played together is a co-op room mechanically, but
                it is not a game anybody set up, and this chip is the only place
                that difference is visible from the board. */}
            <span className="chip chip--brand">
              {room.dailyCoop ? 'Daily co-op' : modeLabel(room.mode)}
            </span>
            {room.totalRounds > 1 && (
              <span className="mono" style={{ fontSize: 13 }}>
                Round {room.round}/{room.totalRounds}
              </span>
            )}
            {room.settings.ranked && <span className="chip chip--accent">ranked</span>}
            <span className="faint" style={{ fontSize: 12.5 }}>
              {room.settings.difficulty}
            </span>
            {room.spectators.length > 0 && (
              <span className="faint" style={{ fontSize: 12.5 }}>
                {room.spectators.length} watching
              </span>
            )}
          </>
        )}

        <span className="grow" />

        {/* The board keeps rendering the last state the server sent, so without
            this the game looks live while nothing is getting through. */}
        {!connected && <span className="chip chip--warn">reconnecting</span>}
        {guessesLeft !== null && (
          <span
            className="mono faint"
            style={{ fontSize: 12.5 }}
            title="Guesses you have left this round"
          >
            {Math.max(0, guessesLeft)} left
          </span>
        )}
        {room.teamGuessesLeft !== null && (
          <span className="chip chip--live">{room.teamGuessesLeft} team guesses</span>
        )}
        <Countdown remaining={remaining} total={room.settings.roundSeconds * 1000} />
      </div>

      {/* ------------------------------------------------------- roster
          One strip instead of a standings rail: who is here, whose turn it is,
          and how close each of them has got. A full table of scores belongs on
          the results screen, not beside the word you are trying to guess. */}
      <div className="roster">
        {standings.map((player) => {
          const out = player.status === 'eliminated' || !player.connected;
          // Same banding as the guess bars, so a rank reads the same colour
          // wherever it appears.
          const heat = player.bestRank !== null ? bandColor(bandForRank(player.bestRank)) : undefined;
          return (
            <motion.div
              // The id, never the index. A pill has to stay the same element
              // across a reorder or there is nothing left for the animation to
              // move: React would rewrite the text in place instead.
              key={player.user.id}
              // Position only. A pill also changes width as its rank goes from
              // "no guesses" to "8,002 away", and animating that alongside the
              // move stretches the text mid-flight. The order is the part worth
              // watching, so the order is the only part that animates.
              layout="position"
              transition={ROSTER_SPRING}
              className={cx(
                'roster__item',
                player.user.id === user?.id && 'roster__item--me',
                room.activePlayerId === player.user.id && 'roster__item--active',
                out && 'roster__item--out',
              )}
              // Carries the whole name, which is what the pill drops first. On a
              // busy strip the avatar plus this is how you identify a row.
              title={`${player.user.displayName} · ${formatAway(player.bestRank)} · ${player.score.toLocaleString()} pts · ${player.guessCount} guesses${
                player.strikes > 0 ? ` · ${player.strikes} strikes` : ''
              }`}
            >
              <Avatar user={player.user} size={26} />
              {rosterName !== 'none' && (
                <span className="truncate" style={{ maxWidth: rosterName === 'full' ? 92 : 62 }}>
                  {rosterName === 'full'
                    ? player.user.displayName
                    : firstName(player.user.displayName)}
                </span>
              )}
              {/* Strikes only exist in sudden death, and there they are the
                  thing you watch, which earns them the extra glyphs. */}
              {player.strikes > 0 && (
                <span style={{ color: 'var(--pink)', fontSize: 11, flex: 'none' }}>
                  {'✕'.repeat(player.strikes)}
                </span>
              )}
              {/* "8,002 away" reads as a gap you are closing where a bare
                  number reads as nothing, and half of it reads as neither, so
                  it is never truncated. Room is made by shortening the name. */}
              <span className="roster__rank" style={{ color: heat, flex: 'none' }}>
                {formatAway(player.bestRank)}
              </span>
            </motion.div>
          );
        })}
      </div>

      {/* Word box, commentary and board are one block rather than three page
          rows. StatusOverlay reserves its height so the list never jumps as
          lines come and go, and at page spacing that reserved band reads as a
          hole whenever nobody is doing anything, hence the tighter gaps. */}
      <div className="col" style={{ gap: 'var(--s1)', minWidth: 0 }}>
        {/* The word box. Deliberately the loudest thing on the page. */}
        <form onSubmit={submit} className="col" style={{ gap: 'var(--s2)' }}>
          <div className="row">
            <input
              ref={inputRef}
              className="input input--word grow"
              placeholder={
                isSpectator
                  ? 'you are spectating'
                  : me?.status === 'found'
                    ? 'you found it, watch the others'
                    : me?.status === 'eliminated'
                      ? 'you are out this round'
                      : !myTurn
                        ? `${nameFor(room.activePlayerId ?? '')} is thinking…`
                        : frozen
                          ? 'frozen after that cold guess…'
                          : 'type a word'
              }
              value={word}
              // readOnly rather than disabled while a guess is in flight. The
              // browser blurs a disabled input and never hands the focus back,
              // which is what dropped the caret on every Enter.
              disabled={!canGuess}
              readOnly={submitting}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={32}
              onChange={(e) => {
                setWord(e.target.value);
                if (guessError) clearGuessError();
              }}
            />
            <button
              className="btn btn--primary"
              // Height tracks .input--word so the pair reads as one control.
              style={{ height: 52, minWidth: 88 }}
              type="submit"
              disabled={!canGuess || submitting || !word.trim()}
            >
              Guess
            </button>
          </div>

          {/* minHeight holds the row open at button height so the board does not
              jump every time a rejection appears or clears. */}
          <div className="row row--wrap" style={{ minHeight: 30, fontSize: 13 }}>
            {/* Live region: a rejected word has to reach a screen reader without
                pulling focus out of the word box. */}
            <span className="grow truncate" aria-live="polite">
              {guessError ? (
                <motion.span
                  // Keyed on the text so a second rejection nudges again rather
                  // than sitting there looking like the first one.
                  key={guessError}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  style={{ display: 'inline-block', color: 'var(--pink)' }}
                >
                  {guessError}
                </motion.span>
              ) : latestGuess?.normalizedFrom ? (
                // The list keeps one form of a word and ranks that one, so a
                // plural or a British spelling still scores. Naming the word
                // that was actually used is how people learn the list is
                // forgiving. It is information rather than a correction, so it
                // shares the rejection's slot but not its colour, and it fades
                // in rather than nudging the way an error does.
                <motion.span
                  key={latestGuess.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="dim"
                  style={{ display: 'inline-block' }}
                >
                  {latestGuess.normalizedFrom} matched as{' '}
                  <span className="bold">{latestGuess.word}</span>
                </motion.span>
              ) : null}
            </span>

            {/* A guess can wait on a slow server for several seconds. Outside the
                live region above, so it is visible without being read out on
                every word. */}
            {submitting && (
              <span className="row faint" style={{ gap: 'var(--s2)', flex: 'none' }}>
                <Spinner size={13} />
                checking
              </span>
            )}

            {/* The hint count rides on its own button rather than being repeated
                in the status bar, because it only means anything where you
                spend it. */}
            {room.settings.hints > 0 && me && (
              <button
                type="button"
                className="btn btn--sm"
                disabled={!canGuess || me.hintsLeft <= 0 || hinting}
                onClick={() => void askHint()}
              >
                {hinting ? <Spinner size={13} /> : <ModeIcon name="spark" size={13} />}
                Hint ({me.hintsLeft})
              </button>
            )}
            {/* Stays mounted and disables instead of unmounting: a freeze or
                somebody else's turn would otherwise shuffle this row every few
                seconds while you are typing next to it. */}
            {me && me.status !== 'found' && me.status !== 'eliminated' && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                disabled={!canGuess}
                onClick={() => {
                  tap();
                  giveUp();
                }}
              >
                Give up
              </button>
            )}
          </div>
        </form>

        {/* Server commentary: who just took the lead, who is closing in. It
            sits on the path your eye already takes from the word box to the
            board. */}
        <StatusOverlay />

        {/* ------------------------------------------------------- board */}
        <div className="col" style={{ gap: 'var(--s2)', minWidth: 0 }}>
          {/* Board switcher. It only appears once you are out of the hunt, which
              is the only time the other boards are on the client at all. It
              scrolls sideways like the roster: wrapped to a second row, the
              tabs push the list they belong to off a short screen. */}
          {showBoards && (
            <div
              className="row"
              style={{
                gap: 'var(--s1)',
                overflowX: 'auto',
                // Hidden the way .roster hides its own: the strip has to scroll,
                // but a permanent 8px scrollbar under it is another band of
                // chrome on a screen with none to spare.
                scrollbarWidth: 'none',
                paddingBottom: 2,
              }}
            >
              <button
                type="button"
                className={cx('chip', watching === null && 'chip--brand')}
                style={{ flex: 'none' }}
                onClick={() => {
                  tap();
                  setWatching(null);
                }}
              >
                your board
              </button>
              {others.map((player) => (
                <button
                  key={player.user.id}
                  type="button"
                  className={cx('chip', watching === player.user.id && 'chip--brand')}
                  style={{ flex: 'none' }}
                  onClick={() => {
                    tap();
                    setWatching(player.user.id);
                  }}
                  title={`Watch ${player.user.displayName}`}
                >
                  {/* A face is quicker to find in a row of tabs than a name you
                      have to read, which is the whole job of this strip. */}
                  <Avatar user={player.user} size={16} />
                  {player.user.displayName}
                  {player.bestRank !== null && (
                    <span className="mono faint" style={{ marginLeft: 6 }}>
                      {formatRank(player.bestRank)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Whose list this is. A highlighted tab above a column of words is
              easy to read straight past, and then somebody else's guesses look
              like your own, so the owner is named here with the two numbers
              that say how their round is going. minHeight keeps the line the
              same height on both boards so switching does not shift the list. */}
          {showBoards && (
            <div className="row" style={{ gap: 'var(--s2)', minWidth: 0, minHeight: 26 }}>
              {watched ? (
                <>
                  <span className="eyebrow" style={{ flex: 'none' }}>
                    watching
                  </span>
                  <Avatar user={watched.user} size={24} />
                  {/* Titled as well as truncated. This line is the answer to
                      "whose guesses am I reading", so a name clipped by a long
                      one has to be recoverable without changing tabs. */}
                  <span className="bold truncate" title={watched.user.displayName}>
                    {watched.user.displayName}
                  </span>
                  <span className="grow" />
                  {/* Both numbers keep flex none: the name is the only part of
                      this line that may lose characters. */}
                  <span className="mono faint" style={{ fontSize: 12, flex: 'none' }}>
                    {guesses.length} {guesses.length === 1 ? 'guess' : 'guesses'}
                  </span>
                  <span
                    className="mono bold"
                    style={{
                      fontSize: 13,
                      flex: 'none',
                      // Same banding as the bars and the roster, so a rank reads
                      // the same colour wherever it appears.
                      color:
                        watched.bestRank !== null
                          ? bandColor(bandForRank(watched.bestRank))
                          : 'var(--text-faint)',
                    }}
                  >
                    {formatAway(watched.bestRank)}
                  </span>
                </>
              ) : (
                <>
                  <span className="faint" style={{ fontSize: 12 }}>
                    your board
                  </span>
                  <span className="grow" />
                  <span className="mono faint" style={{ fontSize: 12, flex: 'none' }}>
                    {guesses.length} {guesses.length === 1 ? 'guess' : 'guesses'}
                  </span>
                </>
              )}
            </div>
          )}
          <GuessList
            guesses={guesses}
            // The pulse and the last-submitted row belong to your own board; on
            // somebody else's they would flash their guess as though it were yours.
            latestId={watched ? null : latestGuessId}
            latestGuess={watched ? null : latestGuess}
            pulse={watched ? 0 : guessSeq}
            emptyHint={
              watched
                ? `${watched.user.displayName} has not guessed yet`
                : isSpectator
                  ? 'watching along, the board fills as they guess'
                  : 'start broad. music, ocean, money. then follow the heat.'
            }
          />
        </div>
      </div>

      {/* ------------------------------------------------------- drawer
          Feed, chat and emotes, open from the start. A match is short, and a
          conversation you have to go looking for never gets started. The toggle
          stays for anyone who wants the board on its own. */}
      <div className="drawer">
        <button
          type="button"
          className="drawer__toggle"
          onClick={() => {
            tap();
            setDrawerOpen((open) => !open);
          }}
          aria-expanded={drawerOpen}
        >
          <span
            style={{
              display: 'flex',
              transform: drawerOpen ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.14s',
            }}
          >
            <ModeIcon name="chevron" size={13} />
          </span>
          <span style={{ flex: 'none' }}>Activity and chat</span>
          {!drawerOpen && lastEntry && (
            <span className="faint truncate grow" style={{ textAlign: 'left' }}>
              {lastEntry.displayName ? `${lastEntry.displayName}: ` : ''}
              {lastEntry.text}
            </span>
          )}
        </button>

        {drawerOpen && (
          // Chat scrolls its own log and keeps the composer pinned, so the
          // drawer gives it a fixed box to divide up rather than scrolling as
          // well. Two nested scrollers would drag the message field out of
          // reach mid-conversation. The 260 is load bearing: Chat caps its log
          // against exactly this height.
          <div
            className="drawer__body"
            style={{ display: 'flex', flexDirection: 'column', height: 260, overflow: 'hidden' }}
          >
            <Chat room={room} />
          </div>
        )}
      </div>

      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => {
          tap();
          leaveRoom();
        }}
        style={{ alignSelf: 'center' }}
      >
        Leave match
      </button>

      {/* Both branches are keyed. AnimatePresence tracks its children by key,
          and two unkeyed siblings both read as the same empty key, so a room
          that went straight from the countdown to a reveal would swap one for
          the other with no fade at either end. */}
      <AnimatePresence>
        {room.phase === 'countdown' && (
          <CountdownOverlay key="countdown" remaining={remaining} />
        )}
        {room.phase === 'roundEnd' && room.lastRound && (
          <RoundReveal key="roundEnd" summary={room.lastRound} remaining={remaining} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overlays. One flat scrim, no blur, no glow.
 * ------------------------------------------------------------------ */

const SCRIM = 'var(--scrim)';

function CountdownOverlay({ remaining }: { remaining: number | null }) {
  const seconds = remaining === null ? 0 : Math.ceil(remaining / 1000);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        background: SCRIM,
      }}
    >
      <div className="col" style={{ alignItems: 'center', gap: 'var(--s5)' }}>
        <Logo size={72} full />
        <AnimatePresence mode="popLayout">
          <motion.div
            key={seconds}
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 1.2, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
            className="mono bold"
            style={{ fontSize: 72, lineHeight: 1 }}
          >
            {seconds > 0 ? seconds : 'GO'}
          </motion.div>
        </AnimatePresence>
        <div className="dim thin">start broad, then close in</div>
      </div>
    </motion.div>
  );
}

function RoundReveal({
  summary,
  remaining,
}: {
  summary: RoundSummary;
  remaining: number | null;
}) {
  const user = useStore((s) => s.user);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        display: 'grid',
        placeItems: 'center',
        padding: 'var(--s4)',
        background: SCRIM,
      }}
    >
      <motion.div
        initial={{ y: 14, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="panel col"
        style={{
          width: 'min(520px, 100%)',
          maxHeight: '88vh',
          minHeight: 0,
          padding: 'var(--s4)',
          gap: 'var(--s3)',
        }}
      >
        <div className="col" style={{ gap: 0, alignItems: 'center', textAlign: 'center' }}>
          <div className="eyebrow">Round {summary.round} · the word was</div>
          <div className="bold" style={{ fontSize: 26, letterSpacing: '-0.02em' }}>
            {summary.secret}
          </div>
        </div>

        {/* Short screens: everything between the word and the next-round clock
            scrolls on its own rather than pushing the panel off the viewport. */}
        <div className="col" style={{ gap: 'var(--s3)', minHeight: 0, overflowY: 'auto' }}>
          {/* Both blocks are omitted rather than left as a heading over nothing:
              a custom word can come back with no neighbours, and a round
              everybody sat out has no entries. */}
          {summary.neighbours.length > 0 && (
            <div className="col" style={{ gap: 'var(--s2)' }}>
              <div className="eyebrow">Closest words</div>
              <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
                {summary.neighbours.map((n) => (
                  <span key={n.word} className="chip">
                    {n.word}
                    <span className="mono faint">{n.rank}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {summary.entries.length > 0 && (
            <div className="col" style={{ gap: 'var(--s2)' }}>
              <div className="eyebrow">How it went</div>
              <div className="col" style={{ gap: 'var(--s1)' }}>
                {summary.entries.map((entry) => {
                  const eliminated = summary.eliminated.includes(entry.playerId);
                  return (
                    <div
                      key={entry.playerId}
                      className="row"
                      style={{
                        gap: 'var(--s2)',
                        padding: 'var(--s1) var(--s2)',
                        borderRadius: 'var(--r-sm)',
                        background:
                          entry.playerId === user?.id ? 'var(--accent-soft)' : 'var(--surface-2)',
                      }}
                    >
                      <span className="mono faint" style={{ width: 24, fontSize: 12, flex: 'none' }}>
                        {ordinal(entry.placement)}
                      </span>
                      <span className="grow truncate">{entry.displayName}</span>
                      {eliminated && (
                        <span style={{ color: 'var(--pink)', fontSize: 12, flex: 'none' }}>out</span>
                      )}
                      <span className="faint mono" style={{ fontSize: 12, flex: 'none' }}>
                        {entry.guessCount}g
                      </span>
                      {entry.foundAt !== null ? (
                        <span
                          className="mono"
                          style={{ fontSize: 13, color: 'var(--green)', flex: 'none' }}
                        >
                          {formatDuration(entry.foundAt)}
                        </span>
                      ) : (
                        <span
                          className="mono"
                          style={{
                            fontSize: 13,
                            flex: 'none',
                            // Null, not falsy: rank 0 does not exist, but a
                            // truthiness test here reads as though it might.
                            color:
                              entry.bestRank !== null
                                ? bandColor(bandForRank(entry.bestRank))
                                : 'var(--text-faint)',
                          }}
                        >
                          {formatRank(entry.bestRank)}
                        </span>
                      )}
                      <span
                        className="mono bold"
                        style={{ fontSize: 13, minWidth: 44, textAlign: 'right', flex: 'none' }}
                      >
                        +{entry.points}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="dim" style={{ textAlign: 'center', fontSize: 13 }}>
          Next round in{' '}
          <span className="bold mono">{remaining === null ? '…' : Math.ceil(remaining / 1000)}</span>
          s
        </div>
      </motion.div>
    </motion.div>
  );
}
