import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  bandForRank,
  type GuessResult,
  type RoomState,
  type RoundSummary,
} from '@mivimoose/shared';
import { Countdown, Feed, GuessList } from '../components/game';
import { Logo } from '../components/Logo';
import { ModeIcon } from '../components/ModeIcon';
import { Avatar } from '../components/ui';
import { bandColor, cx, formatDuration, formatRank, modeLabel, ordinal } from '../lib/format';
import { useCountdown } from '../hooks/useCountdown';
import { useStore } from '../lib/store';

const EMOTES = ['🔥', '🥶', '😭', '🤝', '👀', '🧠', '💀', '🎉'];

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
  const sendChat = useStore((s) => s.sendChat);
  const sendEmote = useStore((s) => s.sendEmote);
  const leaveRoom = useStore((s) => s.leaveRoom);

  const [word, setWord] = useState('');
  const [chat, setChat] = useState('');
  const [submitting, setSubmitting] = useState(false);
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

  const standings = useMemo(
    () =>
      [...room.players].sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aBest = a.bestRank ?? Infinity;
        const bBest = b.bestRank ?? Infinity;
        return aBest - bBest;
      }),
    [room.players],
  );

  const myTurn = !room.activePlayerId || room.activePlayerId === user?.id;
  const frozen = me?.frozenUntil && me.frozenUntil > Date.now() + clockOffset;
  const guessesLeft =
    room.settings.guessLimit > 0 ? room.settings.guessLimit - (me?.guessCount ?? 0) : null;


  const lastEntry = room.feed[room.feed.length - 1];

  useEffect(() => {
    if (room.phase === 'playing' && myTurn && !frozen) inputRef.current?.focus();
  }, [room.phase, room.round, myTurn, frozen]);

  // A new round puts you back in the hunt, so drop back to your own board.
  useEffect(() => {
    setWatching(null);
  }, [room.round]);

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
    setSubmitting(true);
    const result = await guess(value);
    setSubmitting(false);
    if (result) setWord('');
    // Enter always leaves you ready to type the next word: accepted, the box is
    // empty and focused; rejected, the word is still there to edit.
    inputRef.current?.focus();
  }

  return (
    <div className="page page--board">
      {/* ------------------------------------------------------- status */}
      <div className="statusbar">
        <span className="chip chip--brand">{modeLabel(room.mode)}</span>
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

        <span className="grow" />

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
            <div
              key={player.user.id}
              className={cx(
                'roster__item',
                player.user.id === user?.id && 'roster__item--me',
                room.activePlayerId === player.user.id && 'roster__item--active',
                out && 'roster__item--out',
              )}
              title={`${player.user.displayName} · ${player.score.toLocaleString()} pts · ${player.guessCount} guesses${
                player.strikes > 0 ? ` · ${player.strikes} strikes` : ''
              }`}
            >
              <Avatar user={player.user} size={26} />
              <span className="truncate" style={{ maxWidth: 92 }}>
                {player.user.displayName}
              </span>
              {/* Strikes only exist in sudden death, and there they are the
                  thing you watch — worth the extra glyphs on the pill. */}
              {player.strikes > 0 && (
                <span style={{ color: 'var(--pink)', fontSize: 11, flex: 'none' }}>
                  {'✕'.repeat(player.strikes)}
                </span>
              )}
              <span className="roster__rank" style={{ color: heat }}>
                {formatRank(player.bestRank)}
              </span>
            </div>
          );
        })}
      </div>

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
                  ? 'you found it — watch the others'
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
            ) : null}
          </span>

          {/* The hint count rides on its own button rather than being repeated
              in the status bar — it only means anything where you spend it. */}
          {room.settings.hints > 0 && me && (
            <button
              type="button"
              className="btn btn--sm"
              disabled={!canGuess || me.hintsLeft <= 0}
              onClick={() => void hint()}
            >
              <ModeIcon name="spark" size={13} />
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
              onClick={giveUp}
            >
              Give up
            </button>
          )}
        </div>
      </form>

      {/* ------------------------------------------------------- board */}
      <div className="col" style={{ gap: 'var(--s2)', minWidth: 0 }}>
        {/* Board switcher. It only appears once you are out of the hunt, which
            is the only time the other boards are on the client at all. */}
        {canWatch && others.length > 0 && (
          <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
            <button
              type="button"
              className={cx('chip', watching === null && 'chip--brand')}
              onClick={() => setWatching(null)}
            >
              your board
            </button>
            {others.map((player) => (
              <button
                key={player.user.id}
                type="button"
                className={cx('chip', watching === player.user.id && 'chip--brand')}
                onClick={() => setWatching(player.user.id)}
                title={`Watch ${player.user.displayName}`}
              >
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

        <div className="row row--between faint" style={{ fontSize: 12 }}>
          <span>{watched ? `watching ${watched.user.displayName}` : 'your board'}</span>
          <span className="mono">
            {guesses.length} {guesses.length === 1 ? 'guess' : 'guesses'}
          </span>
        </div>
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
                ? 'watching along — the board fills as they guess'
                : 'start broad. music, ocean, money. then follow the heat.'
          }
        />
      </div>

      {/* ------------------------------------------------------- drawer
          Feed, chat and emotes stay shut until asked for, so nothing moves
          beside the board while you are guessing. */}
      <div className="drawer">
        <button
          className="drawer__toggle"
          onClick={() => setDrawerOpen((open) => !open)}
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
          <div className="drawer__body col" style={{ gap: 'var(--s2)' }}>
            {/* Fixed height: the feed keeps its own scroll and stays pinned to
                the newest line instead of stretching the drawer. */}
            <div className="col" style={{ height: 148, minHeight: 0 }}>
              <Feed entries={room.feed} meId={user?.id ?? null} />
            </div>

            {room.settings.emotesEnabled && (
              <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
                {EMOTES.map((emote) => (
                  <button
                    key={emote}
                    className="btn btn--ghost btn--sm"
                    style={{ padding: '0 var(--s2)', fontSize: 16 }}
                    onClick={() => sendEmote(emote)}
                  >
                    {emote}
                  </button>
                ))}
              </div>
            )}

            {room.settings.chatEnabled && (
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  const text = chat.trim();
                  if (!text) return;
                  sendChat(text);
                  setChat('');
                }}
              >
                <input
                  className="input grow"
                  style={{ height: 34 }}
                  placeholder="say something"
                  value={chat}
                  maxLength={240}
                  onChange={(e) => setChat(e.target.value)}
                />
                <button className="btn btn--sm" type="submit" disabled={!chat.trim()}>
                  Send
                </button>
              </form>
            )}
          </div>
        )}
      </div>

      <button className="btn btn--ghost btn--sm" onClick={leaveRoom} style={{ alignSelf: 'center' }}>
        Leave match
      </button>

      <AnimatePresence>
        {room.phase === 'countdown' && <CountdownOverlay remaining={remaining} />}
        {room.phase === 'roundEnd' && room.lastRound && (
          <RoundReveal summary={room.lastRound} remaining={remaining} />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Overlays — one flat scrim, no blur, no glow.
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
                          color: entry.bestRank
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
