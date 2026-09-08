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
import { Avatar, EmptyState, Modal, Section, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { cx, ordinal } from '../lib/format';
import { play } from '../lib/sound';
import { useStore } from '../lib/store';

/** "1 guess", not "1 guesses". Every player hits n=1 on their first go. */
function guessLabel(n: number): string {
  return `${n} ${n === 1 ? 'guess' : 'guesses'}`;
}

/** The today totals really do sit at 1 for whoever opens the word first. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/* Five rows, then it scrolls. The board underneath is the point of the page,
   so today's standings are never allowed to push it off screen. */
const STANDINGS_MAX = 176;

/* The heat bands in the words a player needs, rather than the words the scoring
   code uses. Thresholds mirror BAND_THRESHOLDS in shared/scoring.ts, and the
   swatches read the band tokens rather than the hue tokens behind them, which
   is exactly what bandColor hands the guess bars. So the legend cannot drift
   from the board if that mapping is ever re-pointed. */
const BAND_HELP: { color: string; head: string; body: string }[] = [
  {
    color: 'var(--band-hot)',
    head: 'Green, rank 1 to 300',
    body: 'You are on the right idea. Nudging a green word sideways is usually what finds the answer.',
  },
  {
    color: 'var(--band-warm)',
    head: 'Orange, rank 301 to 1500',
    body: 'Roughly the right area of meaning, but not the right idea yet.',
  },
  {
    color: 'var(--band-cold)',
    head: 'Pink, rank 1501 and worse',
    body: 'Cold. Still worth having, because it rules out a whole direction at once.',
  },
];

/**
 * The daily challenge is the closest thing here to Contexto proper: one word,
 * one column, one list. So it is laid out that way. A narrow page, the word box
 * as the loudest control on screen, and everything else quiet underneath.
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
  // Only shown once the clipboard has actually refused us. See copyShare.
  const [manualCopy, setManualCopy] = useState(false);
  // Bumped by Try again; the only thing the load effect depends on.
  const [attempt, setAttempt] = useState(0);
  // Opening a room is a round trip; without this a second click opens a second room.
  const [opening, setOpening] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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
   * the button are the string being pasted: one source, nothing to drift.
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
      toast('warn', 'Clipboard blocked, so copy it from the box');
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
      // null means the server refused, and the store has already said so.
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

  /* Line two of the header carries the counts about your own attempt. The
     midnight reset used to sit here too; it has moved down to the totals strip,
     next to the numbers it actually qualifies. */
  const status = [
    state.guessCount > 0 ? guessLabel(state.guessCount) : 'unlimited guesses',
    state.standing ? `${ordinal(state.standing)} of ${state.totalSolvers} today` : solvers,
  ].join(' · ');

  /* The squares the paste actually contains, so nobody has to send it blind to
     find out what it says. Counts only now: the tier names were three more
     words to read for something the colours already say, and the info modal
     explains the bands properly. The name survives as the accessible label,
     because a bare number read out after an unspoken emoji says nothing.

     The bar sits beside the board title while you are still playing, and moves
     up into the input's slot, full width and accent, once you solve and the
     input goes away. */
  const shareBar = share ? (
    <div className="row row--wrap" style={{ gap: 'var(--s3)' }}>
      {share.tiers.map((tier) => (
        <span
          key={tier.emoji}
          className="row"
          style={{ gap: 'var(--s1)', fontSize: 12.5 }}
          role="img"
          aria-label={`${tier.count} ${tier.label} ${plural(tier.count, 'guess', 'guesses')}`}
        >
          <span aria-hidden>{tier.emoji}</span>
          <span className="mono" aria-hidden>
            {tier.count}
          </span>
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

  /* The fallback for a refused clipboard, which the Discord webview does often
     enough to matter. Built here and placed twice rather than kept in one fixed
     spot, because the Share button moves when you solve and a box of text three
     sections below the button you just pressed is a box nobody finds. */
  const manualBox =
    manualCopy && share ? (
      <textarea
        className="input mono"
        readOnly
        rows={5}
        value={share.text}
        aria-label="Your daily result"
        style={{ fontSize: 13 }}
        onFocus={(e) => e.currentTarget.select()}
      />
    ) : null;

  return (
    <div className="page page--narrow" style={{ gap: 'var(--s4)' }}>
      <header className="col" style={{ gap: 'var(--s1)' }}>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <Logo size={22} />
          <h2 className="grow">{state.solved ? 'Solved' : 'Daily word'}</h2>
          {/* Pinned: the title beside it is the flexible half, and a date that
              wraps to a second line drags the whole header down with it. */}
          <span className="mono faint" style={{ fontSize: 12.5, flex: 'none' }}>
            {state.date}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ padding: '0 var(--s2)', flex: 'none' }}
            aria-label="What the ranks, colours and share summary mean"
            onClick={() => {
              play('click');
              setHelpOpen(true);
            }}
          >
            <ModeIcon name="info" size={16} />
          </button>
        </div>
        <p className="dim thin" style={{ margin: 0, fontSize: 13.5 }}>
          {status}
        </p>
      </header>

      {/* The whole point of a daily is that it is one word and everybody is on
          it. That only lands if the totals are given room, so they get a box and
          a row of their own rather than another clause in the header line. */}
      <div
        className="row row--wrap"
        style={{
          gap: 'var(--s5)',
          padding: 'var(--s3) var(--s4)',
          borderRadius: 'var(--r)',
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
        }}
      >
        {/* flex none on both, so a narrow window wraps the sentence below the
            numbers instead of squeezing the uppercase labels onto two lines. */}
        <div className="col" style={{ flex: 'none' }}>
          <span className="metric__value">{state.totalGuessesToday.toLocaleString()}</span>
          <span className="metric__label">
            {plural(state.totalGuessesToday, 'guess today', 'guesses today')}
          </span>
        </div>
        <div className="col" style={{ flex: 'none' }}>
          <span className="metric__value">{state.totalPlayersToday.toLocaleString()}</span>
          <span className="metric__label">
            {plural(state.totalPlayersToday, 'person trying', 'people trying')}
          </span>
        </div>
        <p
          className="grow dim thin"
          style={{ margin: 0, minWidth: 150, fontSize: 13, lineHeight: 1.45 }}
        >
          Everyone is working on the same word today. It holds until midnight UTC.
        </p>
      </div>

      {/* Co-op belongs under the header, not beside the board: it is another way
          into today's word rather than an action on the guesses you already have. */}
      <div className="col" style={{ gap: 'var(--s1)', alignItems: 'flex-start' }}>
        <button
          type="button"
          className="btn btn--sm"
          disabled={opening || !connected}
          onClick={() => void openCoop()}
        >
          {/* Swapped, not added, so the label does not shift sideways the
              moment the request starts. */}
          {opening ? <Spinner size={13} /> : <ModeIcon name="users" size={13} />}
          Play today's word together
        </button>
        {/* One paragraph, not four lines: these are all footnotes to the same
            button, and a page this tall cannot spare a row for each. What the
            room is NOT comes first, because a button that opens a room reads as
            a custom game unless it is told otherwise. The offline note is here
            rather than in a title attribute because a disabled button swallows
            hover on most browsers. */}
        <p className="faint thin" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.45 }}>
          Not a custom game: it opens today's word, the same one you are guessing here.
          Everyone adds to one shared board, and nobody sees the answer.
          {isGuest && ' Inviting people by name needs a Discord sign-in.'}
          {!connected && ' Waiting for the connection before a room can open.'}
        </p>
      </div>

      {/* Solved: the guess box has gone, so the share bar takes the slot it
          left. Full width and on its own row, with the fallback text box
          directly under the button that fills it. */}
      {state.solved && shareBar && (
        <div className="col" style={{ gap: 'var(--s2)' }}>
          {shareBar}
          {manualBox}
        </div>
      )}

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
        <div className="col" style={{ gap: 'var(--s3)' }}>
          {!state.solved && manualBox}
          {/* No height cap. GuessList shows the ten closest and puts the rest
              behind "See all", so the board is already bounded and squeezing it
              again only made the rows harder to read as the round went on. */}
          <div ref={boardRef} role="group" aria-label="Your guesses, closest first">
            <GuessList
              guesses={state.guesses}
              latestId={latestId}
              emptyHint="no guesses yet, so start with something broad."
            />
          </div>
        </div>
      </Section>

      <Section title="Today's fastest" action={<span className="faint thin">fewest guesses</span>}>
        {board.length === 0 ? (
          <EmptyState title="Nobody has solved it yet" hint="be the first today." />
        ) : (
          <ol
            className="col"
            tabIndex={0}
            aria-label="Today's fastest solvers"
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
                {/* The guess count is the entire content of this list, so a
                    long name trims itself rather than squeezing the number. */}
                <span className="mono bold" style={{ flex: 'none' }}>
                  {row.value}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Modal open={helpOpen} title="How the daily works" onClose={() => setHelpOpen(false)}>
        <div className="col" style={{ gap: 'var(--s5)', fontSize: 13.5, lineHeight: 1.55 }}>
          <section className="col" style={{ gap: 'var(--s1)' }}>
            <h3>What a rank is</h3>
            <p className="dim thin" style={{ margin: 0 }}>
              Every word in the dictionary is sorted by how close its meaning sits to today's
              answer, and your rank is the position your word landed on in that order. Rank 1
              is the answer itself. Rank 900 means 899 words are closer than the one you
              played. It measures meaning rather than spelling, so "cat" sits near "kitten"
              and nowhere near "cot".
            </p>
          </section>

          <section className="col" style={{ gap: 'var(--s2)' }}>
            <h3>What the colours mean</h3>
            <p className="dim thin" style={{ margin: 0 }}>
              The bar behind each guess grows as the rank gets lower, and its colour is the
              quick read.
            </p>
            {BAND_HELP.map((band) => (
              <div
                key={band.head}
                className="row"
                style={{ gap: 'var(--s3)', alignItems: 'stretch' }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 4,
                    flex: 'none',
                    borderRadius: 'var(--r-pill)',
                    background: band.color,
                  }}
                />
                <span className="col">
                  <span className="bold">{band.head}</span>
                  <span className="dim thin">{band.body}</span>
                </span>
              </div>
            ))}
          </section>

          <section className="col" style={{ gap: 'var(--s1)' }}>
            <h3>What Share copies</h3>
            <p className="dim thin" style={{ margin: 0 }}>
              A few lines for your clipboard: today's date, how many guesses you have made,
              your place among today's solvers once you have finished, and one square per
              guess grouped into those same three bands. It never contains a word you typed
              or the answer, so pasting it into a group chat spoils nothing for someone who
              has not played yet. The squares beside the Share button are the ones the paste
              holds.
            </p>
          </section>

          <section className="col" style={{ gap: 'var(--s1)' }}>
            <h3>One word a day</h3>
            <p className="dim thin" style={{ margin: 0 }}>
              Everyone playing gets the same word, and it holds until midnight UTC. Guesses
              are unlimited and there is no clock, so nothing is lost by leaving it and
              coming back later. The totals at the top of the page are every guess everyone
              has made on today's word, and how many people have had a go at it.
            </p>
          </section>

          <section className="col" style={{ gap: 'var(--s1)' }}>
            <h3>Playing it with friends</h3>
            <p className="dim thin" style={{ margin: 0 }}>
              "Play today's word together" opens a room on this same word rather than a
              custom game with settings to pick. Every guess made in there lands on one
              board that the whole room shares, and the answer stays hidden from all of you,
              including whoever opened the room.
            </p>
          </section>
        </div>
      </Modal>
    </div>
  );
}
