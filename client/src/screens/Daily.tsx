import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildDailyShare,
  dailyTierBreakdown,
  type DailyChallengeState,
  type LeaderboardRow,
} from '@mivimoose/shared';
import { GuessList } from '../components/game';
import { Logo } from '../components/Logo';
import { ModeIcon } from '../components/ModeIcon';
import { Avatar, EmptyState, Section, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cx, ordinal } from '../lib/format';
import { play } from '../lib/sound';
import { useStore } from '../lib/store';

/** "1 guess", not "1 guesses" — every player hits n=1 on their first go. */
function guessLabel(n: number): string {
  return `${n} ${n === 1 ? 'guess' : 'guesses'}`;
}

/* Seven rows, then it scrolls. The board underneath is the point of the page,
   so today's standings are never allowed to push it off screen. */
const STANDINGS_MAX = 224;

/* Six rows of the board, then it scrolls too. Both lists on this page are
   open-ended, so if neither is capped a long session pushes the standings off
   the bottom and the page grows instead of the list. Six is the useful window:
   the list is sorted by rank, so the rows on show are the closest guesses. */
const BOARD_MAX = 228;

/**
 * The daily challenge is the closest thing here to Contexto proper: one word,
 * one column, one list. So it is laid out that way — a narrow page, the word
 * box as the loudest control on screen, and everything else quiet underneath.
 */
export function Daily() {
  const toast = useStore((s) => s.toast);
  const connected = useStore((s) => s.connected);
  // Co-op itself works for guests; only naming someone in an invite does not.
  const isGuest = useStore((s) => s.user?.isGuest ?? false);
  const [state, setState] = useState<DailyChallengeState | null>(null);
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [word, setWord] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [latestId, setLatestId] = useState<string | null>(null);
  // Only shown once the clipboard has actually refused us — see copyShare.
  const [manualCopy, setManualCopy] = useState(false);
  // Bumped by Try again; the only thing the load effect depends on.
  const [attempt, setAttempt] = useState(0);
  // Opening a room is a round trip; without this a second click opens a second room.
  const [opening, setOpening] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // The pinned copy of your last guess is the first thing in the board's
  // scroller, so a board left scrolled down would answer "how did that do?"
  // off screen. Snap back on every new row.
  useEffect(() => {
    if (latestId && boardRef.current) boardRef.current.scrollTop = 0;
  }, [latestId]);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    api.daily().then(
      (next) => !cancelled && setState(next),
      // Without a failure branch the screen sat on a spinner for ever whenever
      // /daily was down, with no way back.
      () => !cancelled && setLoadFailed(true),
    );
    api
      .dailyLeaderboard()
      .then((r) => !cancelled && setBoard(r.rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /**
   * Built during render rather than on click, so the tier counts shown beside
   * the button are the string being pasted — one source, nothing to drift.
   */
  const share = useMemo(() => {
    if (!state || state.guesses.length === 0) return null;
    return {
      text: buildDailyShare({
        date: state.date,
        guesses: state.guesses,
        solved: state.solved,
        standing: state.standing,
        url: window.location.origin,
      }),
      tiers: dailyTierBreakdown(state.guesses).filter((tier) => tier.count > 0),
    };
  }, [state]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = word.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { result, state: next } = await api.dailyGuess(value);
      setState(next);
      setLatestId(result.id);
      setWord('');
      if (result.rank === 1) {
        toast('success', `Solved in ${guessLabel(next.guessCount)}`);
        // Your row only exists on the board once you are actually on it.
        api.dailyLeaderboard().then((r) => setBoard(r.rows)).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function copyShare(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setManualCopy(false);
      toast('success', 'Copied');
    } catch {
      // Discord's webview and any insecure origin will refuse the clipboard, so
      // put the text on screen instead of losing it.
      setManualCopy(true);
      toast('warn', 'Clipboard blocked — copy it from the box');
    }
  }

  /**
   * The store owns the socket call and switches to the play tab itself, so
   * this only has to own the button's disabled state. It is read through
   * getState rather than subscribed to: the action never changes, and
   * subscribing would re-render the board for nothing.
   */
  async function openCoop() {
    play('click');
    setOpening(true);
    try {
      // null means the server refused — the store has already said so.
      await useStore.getState().startDailyCoop();
    } finally {
      setOpening(false);
    }
  }

  if (!state) {
    return (
      <div className="page page--narrow" style={{ alignItems: 'center' }}>
        {loadFailed ? (
          <>
            <EmptyState title="Could not load today's word" hint="the server did not answer." />
            <button className="btn btn--sm" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </>
        ) : (
          <Spinner size={22} />
        )}
      </div>
    );
  }

  const solvers =
    state.totalSolvers === 0
      ? 'nobody has it yet'
      : `${state.totalSolvers} solved${state.bestGuessCount ? `, best ${state.bestGuessCount}` : ''}`;

  // Line two of the header carries the counts that would otherwise each want a
  // row of their own.
  const status = [
    state.guessCount > 0 ? guessLabel(state.guessCount) : 'unlimited guesses',
    state.standing ? `${ordinal(state.standing)} of ${state.totalSolvers} today` : solvers,
    'resets midnight UTC',
  ].join(' · ');

  /* The tiers the paste actually contains, so nobody has to send it blind to
     find out what it says. It sits beside the board title while you are still
     playing, and moves up into the input's slot — full width, accent — once
     you solve and the input goes away. */
  const shareBar = share ? (
    <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
      {share.tiers.map((tier) => (
        <span key={tier.label} className="row" style={{ gap: 'var(--s1)', fontSize: 12.5 }}>
          <span aria-hidden>{tier.emoji}</span>
          <span className="mono">{tier.count}</span>
          <span className="faint thin">{tier.label}</span>
        </span>
      ))}
      <span className="grow" />
      <button
        type="button"
        className={cx('btn', state.solved ? 'btn--primary' : 'btn--sm')}
        onClick={() => void copyShare(share.text)}
      >
        Share
      </button>
    </div>
  ) : null;

  return (
    <div className="page page--narrow" style={{ gap: 'var(--s4)' }}>
      <header className="col" style={{ gap: 'var(--s1)' }}>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <Logo size={22} />
          <h2 className="grow">{state.solved ? 'Solved' : 'Daily word'}</h2>
          <span className="mono faint" style={{ fontSize: 12.5 }}>
            {state.date}
          </span>
        </div>
        <p className="dim thin" style={{ margin: 0, fontSize: 13.5 }}>
          {status}
        </p>
      </header>

      {/* Co-op belongs under the header, not beside the board: it is another way
          into today's word rather than an action on the guesses you already have. */}
      <div className="col" style={{ gap: 'var(--s1)' }}>
        <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
          <button
            type="button"
            // Matched to the Share button beside it, which grows once you
            // solve: two buttons of different heights in one row read as a
            // mistake.
            className={cx('btn', !state.solved && 'btn--sm')}
            disabled={opening || !connected}
            onClick={() => void openCoop()}
          >
            {/* Swapped, not added, so the label does not shift sideways the
                moment the request starts. */}
            {opening ? <Spinner size={13} /> : <ModeIcon name="users" size={13} />}
            Play with friends
          </button>
          {/* Solved: the guess box is gone, so share moves up beside co-op
              instead of holding a row of its own. */}
          {state.solved && shareBar && <div className="grow">{shareBar}</div>}
        </div>
        {/* One paragraph, not three lines: both notes are footnotes to the same
            sentence, and a page this tall cannot spare a row for each. The
            offline note is here rather than in a title attribute because a
            disabled button swallows hover on most browsers. */}
        <p className="faint thin" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
          Everyone works the same word together on one shared board.
          {isGuest && ' Inviting people by name needs a Discord sign-in.'}
          {!connected && ' Waiting for the connection before a room can open.'}
        </p>
      </div>

      {!state.solved && (
        <form onSubmit={submit} className="col" style={{ gap: 'var(--s2)' }}>
          <div className="row">
            <input
              className="input input--word grow"
              placeholder="type a word"
              aria-label="Guess a word"
              value={word}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              onChange={(e) => {
                setWord(e.target.value);
                if (error) setError(null);
              }}
            />
            <button className="btn btn--primary" style={{ height: 52 }} disabled={busy || !word.trim()}>
              Guess
            </button>
          </div>
          {error && (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 13 }}>
              {error}
            </span>
          )}
        </form>
      )}

      <Section title="Your board" action={state.solved ? undefined : shareBar}>
        {manualCopy && share && (
          <textarea
            className="input mono"
            readOnly
            rows={5}
            value={share.text}
            aria-label="Your daily result"
            style={{ fontSize: 13, marginBottom: 'var(--s3)' }}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <div ref={boardRef} style={{ maxHeight: BOARD_MAX, overflowY: 'auto' }}>
          <GuessList
            guesses={state.guesses}
            latestId={latestId}
            emptyHint="no guesses yet — start with something broad."
          />
        </div>
      </Section>

      <Section title="Today's fastest" action={<span className="faint thin">fewest guesses</span>}>
        {board.length === 0 ? (
          <EmptyState title="Nobody has solved it yet" hint="be the first today." />
        ) : (
          <ol
            className="col"
            style={{
              gap: 'var(--s1)',
              margin: 0,
              padding: 0,
              listStyle: 'none',
              maxHeight: STANDINGS_MAX,
              overflowY: 'auto',
            }}
          >
            {board.map((row) => (
              <li
                key={row.user.id}
                className="row"
                style={{
                  gap: 'var(--s3)',
                  padding: 'var(--s1) var(--s2)',
                  borderRadius: 'var(--r-sm)',
                  background: row.isMe ? 'var(--surface-3)' : 'var(--surface-2)',
                }}
              >
                {/* minWidth, not width: past rank 99 a fixed box spills the
                    number under the avatar. */}
                <span className="mono dim" style={{ minWidth: 18, fontSize: 13, flex: 'none' }}>
                  {row.rank}
                </span>
                <Avatar user={row.user} size={22} />
                <span className={cx('grow truncate', row.isMe && 'bold')}>{row.user.displayName}</span>
                <span className="mono bold">{row.value}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
