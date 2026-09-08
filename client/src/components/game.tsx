import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { heatFraction, type FeedEntry, type GuessResult, type RoomPlayer, type RoomState } from '@mivimoose/shared';
import { bandColor, cx, formatClock, formatRank, modeLabel } from '../lib/format';
import { Avatar, EmptyState, Modal } from './ui';

/* ------------------------------------------------------------------ *
 * Guess row
 * ------------------------------------------------------------------ */

/**
 * What gives up width first when a row does not fit.
 *
 * Flex shares the shortfall in proportion to shrink x current width, so these
 * numbers have to sit orders apart for the priority to actually hold. Reading
 * order of who yields: the quiet "typed" note, then the line about who played
 * the word first, then the owner chip, and the word only once everything else
 * has collapsed. The rank is not in this table at all. It is `flex: none`,
 * because a row whose number has been squeezed off the end has lost the one
 * thing it exists to say.
 */
const SHRINK = { word: 1, owner: 10, claim: 80, typed: 500 } as const;

/** The commentary beside a word: same size and shrink behaviour, hue varies. */
const noteStyle = (shrink: number, color: string): CSSProperties => ({
  flex: `0 ${shrink} auto`,
  minWidth: 0,
  fontSize: 12.5,
  color,
});

/**
 * One guess, built the way Contexto builds it: a flat track, a colour bar whose
 * width is `exp(-rank / tau)`, and the word and rank sitting on top.
 *
 * The bar spends almost the whole cold tail invisible and only starts moving
 * when you are genuinely close, which is what makes the last few guesses feel
 * like they matter.
 *
 * The one addition is the steal marker. When a word was already played by
 * someone else this round the row says who got there first. That is the whole
 * social mechanic of a duel, so it earns a place on the row itself.
 */
export function GuessRow({
  guess,
  pinned,
  ownerName,
}: {
  guess: GuessResult;
  /** Rendered as the pinned copy above the list rather than inside it. */
  pinned?: boolean;
  /** Who played it, on a shared board. Left off when every row is yours. */
  ownerName?: string;
}) {
  const color = bandColor(guess.band);
  const found = guess.rank === 1;
  // The word ranked is not always the word typed. Kept on the row itself when
  // there is room, and on the word's tooltip always, so a plural or a British
  // spelling never silently turns into something else.
  const typedNote = guess.normalizedFrom
    ? `You typed ${guess.normalizedFrom}, ranked as ${guess.word}`
    : undefined;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
      className={cx('guess', found && 'guess--found', guess.repeat && 'guess--repeat')}
    >
      <motion.div
        className="guess__bar"
        // Pinned rows re-render on every guess, so they animate from their
        // current width rather than replaying from zero each time.
        initial={pinned ? false : { width: 0 }}
        animate={{ width: `${heatFraction(guess.rank) * 100}%` }}
        transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
        style={{ background: color }}
      />
      <div className="guess__content">
        {/* Owner first, as a chip: leading with the name gives the eye one
            column for "whose is this" instead of a name column squeezed in
            beside the word. The cap is a share of the row rather than a fixed
            width, so ordinary names show in full and only a genuinely long one
            is trimmed. */}
        {ownerName && (
          <span
            className="chip"
            title={ownerName}
            style={{
              flex: `0 ${SHRINK.owner} auto`,
              minWidth: 0,
              maxWidth: '34%',
              height: 18,
              fontSize: 11,
              // One step up from the row's own ground so the chip still reads
              // where the heat bar runs underneath it.
              background: 'var(--surface-3)',
            }}
          >
            {/* .chip is a flex container and text-overflow does not apply to
                one, so the name needs its own block box to ellipsis inside. */}
            <span className="truncate" style={{ minWidth: 0 }}>
              {ownerName}
            </span>
          </span>
        )}

        <span
          className="guess__word truncate"
          style={{ flex: `0 ${SHRINK.word} auto`, minWidth: 0 }}
          title={typedNote}
        >
          {guess.word}
        </span>

        {/* The server ranks a resolved form: "harbor" for a typed "harbours".
            Naming what you typed stops that reading as the game ignoring you,
            while the ranked word stays the loud half of the pair. */}
        {guess.normalizedFrom && (
          <span className="truncate" style={noteStyle(SHRINK.typed, 'var(--text-dim)')} title={typedNote}>
            typed {guess.normalizedFrom}
          </span>
        )}

        {guess.isHint && (
          <span className="chip chip--accent" style={{ height: 19, fontSize: 10.5, flex: 'none' }}>
            hint
          </span>
        )}

        {/* Two different "you have seen this word before" cases, worded so you
            can tell them apart without reading twice: one is your own memory
            slipping, the other is an opponent having beaten you to it. */}
        {guess.repeat && (
          <span
            className="truncate"
            style={noteStyle(SHRINK.claim, 'var(--text-dim)')}
            title="You already guessed this word."
          >
            You already guessed this word.
          </span>
        )}

        {guess.stolenFrom && !guess.repeat && (
          <span
            className="truncate"
            style={noteStyle(SHRINK.claim, 'var(--pink)')}
            title={`${guess.stolenFrom.displayName} played this word first`}
          >
            {guess.stolenFrom.displayName} guessed this word before you.
          </span>
        )}

        {/* Never shrinks: the rank is the reason the row exists. */}
        <span className="guess__rank" style={{ flex: 'none' }}>
          {found ? 1 : formatRank(guess.rank)}
        </span>
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ *
 * Guess list
 * ------------------------------------------------------------------ */

/**
 * How many rows the board itself keeps.
 *
 * Ten is roughly where a Contexto board stops being something you read and
 * turns into something you scroll. The rows that matter are the ones closing in
 * on 1, and every cold guess you keep on screen pushes them further from your
 * eye. The rest are not thrown away, they move one click back.
 */
const BOARD_ROWS = 10;

/**
 * Filter match for the browser search.
 *
 * Both halves of the pair a row can show are searchable: the word that was
 * ranked, and the word that was actually typed. Typing "harbours" and getting
 * nothing back would read as that guess having been lost, when in truth it is
 * sitting there under "harbor".
 */
function matchesQuery(guess: GuessResult, needle: string): boolean {
  return (
    guess.word.toLowerCase().includes(needle) ||
    (guess.normalizedFrom?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * The board: your latest guess held still at the top, and under it the ten
 * closest guesses of the round. Everything else sits behind one button.
 *
 * The pinned row is the point. Without it, playing a cold word sends it to the
 * bottom of a long list and you never see where it landed. So the answer to
 * "what did that do?" is always in the same place, and the list underneath is
 * left alone rather than scrolled around under you.
 */
export function GuessList({
  guesses,
  latestId,
  latestGuess,
  pulse = 0,
  emptyHint,
  showOwners = false,
  nameFor,
}: {
  guesses: GuessResult[];
  latestId?: string | null;
  /** The server's reply to the last submission, which is the only copy that
   *  carries `repeat`. Preferred over the stored row when the ids match. */
  latestGuess?: GuessResult | null;
  /** Changes on every submission so a repeated word still re-flashes. */
  pulse?: number;
  emptyHint?: string;
  /** Shared boards (co-op, or full visibility) where the rows come from more
   *  than one player and each needs a name on it. */
  showOwners?: boolean;
  nameFor?: (playerId: string) => string;
}) {
  const [browsing, setBrowsing] = useState(false);
  const [query, setQuery] = useState('');

  const latest = useMemo(() => {
    if (!latestId) return undefined;
    if (latestGuess && latestGuess.id === latestId) return latestGuess;
    return guesses.find((g) => g.id === latestId);
  }, [guesses, latestId, latestGuess]);

  const sorted = useMemo(() => [...guesses].sort((a, b) => a.rank - b.rank), [guesses]);
  const top = useMemo(() => sorted.slice(0, BOARD_ROWS), [sorted]);

  const needle = query.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? sorted.filter((guess) => matchesQuery(guess, needle)) : sorted),
    [sorted, needle],
  );

  const ownerOf = (guess: GuessResult) =>
    showOwners && nameFor ? nameFor(guess.playerId) : undefined;

  const closeBrowser = () => {
    setBrowsing(false);
    // Opening the list again should show the whole list, not whatever was left
    // in the box the last time it was open.
    setQuery('');
  };

  // A round ending, or switching to a board nobody has guessed on yet, empties
  // the list and takes the dialog off screen while it is still flagged open.
  // Clearing the flag here stops it reappearing on its own the next time this
  // board has rows to show.
  useEffect(() => {
    if (guesses.length === 0) {
      setBrowsing(false);
      setQuery('');
    }
  }, [guesses.length]);

  if (!guesses.length) {
    return (
      <div className="faint" style={{ padding: 'var(--s6) var(--s2)', textAlign: 'center', fontSize: 14 }}>
        {emptyHint ?? 'Nothing guessed yet.'}
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 'var(--s3)', minHeight: 0 }}>
      {latest && (
        <div className="col" style={{ gap: 'var(--s2)' }}>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            <GuessRow
              key={`pinned-${latest.id}-${pulse}`}
              guess={latest}
              ownerName={ownerOf(latest)}
              pinned
            />
          </ul>
          {/* Your last guess is usually in the ranked list below as well, and is
              behind the button instead when it landed outside the ten. Without a
              divider the two copies read as a duplicate bug rather than "here is
              your last guess, and here is where it sits". */}
          <div
            aria-hidden="true"
            style={{ height: 1, background: 'var(--line)', margin: '0 var(--s1)' }}
          />
        </div>
      )}

      <ul
        className="col"
        style={{ margin: 0, padding: 0, gap: 'var(--s1)', listStyle: 'none', minHeight: 0 }}
      >
        <AnimatePresence initial={false}>
          {top.map((guess) => (
            <GuessRow key={guess.id} guess={guess} ownerName={ownerOf(guess)} />
          ))}
        </AnimatePresence>
      </ul>

      {/* Not a ghost button. It is the only route to the rest of the round, and
          under a stack of coloured rows a borderless one stops reading as a
          control at all. */}
      {sorted.length > BOARD_ROWS && (
        <button
          type="button"
          className="btn btn--sm btn--block"
          onClick={() => setBrowsing(true)}
          aria-haspopup="dialog"
        >
          See all {sorted.length} guesses
        </button>
      )}

      <Modal open={browsing} title="All guesses" onClose={closeBrowser}>
        <div className="col" style={{ gap: 'var(--s3)', minHeight: 0 }}>
          <div className="row" style={{ gap: 'var(--s3)' }}>
            <input
              className="input grow"
              value={query}
              // The box is the reason this dialog opened, so it takes the caret
              // without a second click.
              autoFocus
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by word"
              aria-label="Filter guesses by word"
              style={{ height: 36 }}
            />
            <span
              className="mono faint"
              aria-live="polite"
              style={{ fontSize: 12.5, flex: 'none' }}
            >
              {needle ? `${matches.length} of ${sorted.length}` : `${sorted.length} guesses`}
            </span>
          </div>

          {/* A floor under the results. An unfiltered list is always at its cap
              here, so without one the dialog collapses the moment a filter
              narrows to a row or two and springs back when the box is cleared,
              which makes it lurch under the cursor while you type. */}
          <div style={{ minHeight: 160 }}>
            {matches.length === 0 ? (
              <EmptyState
                title="No word matches that"
                hint={`None of the ${sorted.length} guesses contain "${query.trim()}".`}
              />
            ) : (
              <ul
                className="col"
                style={{
                  margin: 0,
                  padding: 0,
                  gap: 'var(--s1)',
                  listStyle: 'none',
                  // The dialog is capped, so the list scrolls inside it instead
                  // of pushing the search box off the top on a long round.
                  maxHeight: 'min(52vh, 360px)',
                  overflowY: 'auto',
                }}
              >
                {matches.map((guess) => (
                  <GuessRow key={guess.id} guess={guess} ownerName={ownerOf(guess)} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Player rail
 * ------------------------------------------------------------------ */

const STATUS_META: Record<RoomPlayer['status'], { label: string; color: string }> = {
  lobby: { label: 'Waiting', color: 'var(--text-faint)' },
  ready: { label: 'Ready', color: 'var(--green)' },
  playing: { label: 'Hunting', color: 'var(--accent)' },
  found: { label: 'Found it', color: 'var(--green)' },
  eliminated: { label: 'Out', color: 'var(--pink)' },
  spectating: { label: 'Watching', color: 'var(--text-faint)' },
  disconnected: { label: 'Offline', color: 'var(--text-faint)' },
};

export function PlayerCard({
  player,
  isMe,
  isActive,
  rank,
  onKick,
  onPromote,
  compact,
}: {
  player: RoomPlayer;
  isMe: boolean;
  isActive?: boolean;
  rank?: number;
  onKick?: () => void;
  onPromote?: () => void;
  compact?: boolean;
}) {
  const status = STATUS_META[player.status];
  const heat = player.bestRank !== null ? bandColor(bandFromRank(player.bestRank)) : null;
  const out = player.status === 'eliminated' || !player.connected;

  return (
    <motion.div
      layout="position"
      transition={{ type: 'spring', stiffness: 460, damping: 38 }}
      className="row"
      style={{
        gap: 10,
        padding: compact ? '7px 10px' : '9px 11px',
        borderRadius: 'var(--r)',
        background: isMe ? 'var(--accent-soft)' : 'var(--surface-2)',
        border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
        opacity: out ? 0.5 : 1,
      }}
    >
      {rank !== undefined && (
        <span className="faint mono" style={{ fontSize: 12, width: 14, flex: 'none' }}>
          {rank}
        </span>
      )}

      <Avatar user={player.user} size={compact ? 26 : 30} ring={isMe ? 'var(--accent)' : undefined} />

      <div className="grow col" style={{ gap: 0, minWidth: 0 }}>
        <div className="row" style={{ gap: 5 }}>
          <span className="truncate" style={{ fontSize: 14 }}>
            {player.user.displayName}
          </span>
          {player.isHost && (
            <span className="chip chip--brand" style={{ height: 16, fontSize: 10, padding: '0 5px' }}>
              host
            </span>
          )}
        </div>
        <div className="row" style={{ gap: 6, fontSize: 12 }}>
          <span style={{ color: status.color }}>{status.label}</span>
          {player.guessCount > 0 && <span className="faint">{player.guessCount} guesses</span>}
          {player.strikes > 0 && <span style={{ color: 'var(--pink)' }}>{'✕'.repeat(player.strikes)}</span>}
        </div>
      </div>

      <div className="col" style={{ alignItems: 'flex-end', gap: 0, flex: 'none' }}>
        {player.bestRank !== null && heat && (
          <span className="mono bold" style={{ fontSize: 14, color: heat }}>
            {formatRank(player.bestRank)}
          </span>
        )}
        {player.score > 0 && (
          <span className="mono faint" style={{ fontSize: 11 }}>
            {player.score.toLocaleString()}
          </span>
        )}
      </div>

      {(onKick || onPromote) && (
        <div className="row" style={{ gap: 2, flex: 'none' }}>
          {onPromote && (
            <button className="btn btn--ghost btn--sm" onClick={onPromote} title="Make host">
              ♔
            </button>
          )}
          {onKick && (
            <button className="btn btn--ghost btn--sm" onClick={onKick} title="Remove">
              ✕
            </button>
          )}
        </div>
      )}
    </motion.div>
  );
}

function bandFromRank(rank: number) {
  if (rank <= 1) return 'found' as const;
  if (rank <= 300) return 'hot' as const;
  if (rank <= 1500) return 'warm' as const;
  return 'cool' as const;
}

/* ------------------------------------------------------------------ *
 * Timer
 * ------------------------------------------------------------------ */

export function Countdown({ remaining, total }: { remaining: number | null; total: number }) {
  if (remaining === null) {
    return <span className="chip mono">No limit</span>;
  }

  const fraction = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 0;
  const urgent = remaining < 15000;
  const color = urgent ? 'var(--pink)' : remaining < 40000 ? 'var(--orange)' : 'var(--text)';

  return (
    <div className="row" style={{ gap: 10 }}>
      <span
        className="mono bold"
        style={{
          fontSize: 18,
          color,
          minWidth: 46,
          animation: urgent ? 'pulse-soft 1s ease-in-out infinite' : undefined,
        }}
      >
        {formatClock(remaining)}
      </span>
      <span
        style={{
          width: 72,
          height: 4,
          borderRadius: 'var(--r-pill)',
          background: 'var(--surface-3)',
          overflow: 'hidden',
        }}
      >
        <span
          style={{
            display: 'block',
            width: `${fraction * 100}%`,
            height: '100%',
            background: color,
            transition: 'width 0.12s linear',
          }}
        />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Feed
 * ------------------------------------------------------------------ */

export function Feed({ entries, meId }: { entries: FeedEntry[]; meId: string | null }) {
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);

  return (
    <div
      ref={scroller}
      className="col"
      style={{ gap: 6, overflowY: 'auto', minHeight: 0, flex: 1 }}
    >
      {entries.length === 0 && (
        <div className="faint" style={{ fontSize: 13, padding: 12, textAlign: 'center' }}>
          Nothing yet.
        </div>
      )}
      {entries.map((entry) => {
        const mine = entry.playerId === meId;
        const isChat = entry.kind === 'chat';

        if (entry.kind === 'emote') {
          return (
            <div key={entry.id} className="row" style={{ gap: 6, fontSize: 13 }}>
              <span className="faint truncate" style={{ maxWidth: 96 }}>
                {entry.displayName}
              </span>
              <span style={{ fontSize: 18 }}>{entry.text}</span>
            </div>
          );
        }

        return (
          <div
            key={entry.id}
            className="row"
            style={{
              gap: 8,
              alignItems: 'baseline',
              fontSize: 13,
              padding: isChat ? '6px 8px' : 0,
              borderRadius: 'var(--r-sm)',
              background: isChat ? 'var(--surface-2)' : undefined,
            }}
          >
            <span className="grow" style={{ minWidth: 0, wordBreak: 'break-word' }}>
              {isChat ? (
                <>
                  <span style={{ color: mine ? 'var(--accent)' : 'var(--text)' }}>
                    {entry.displayName}
                  </span>
                  <span className="dim"> {entry.text}</span>
                </>
              ) : (
                <span className={entry.kind === 'found' ? 'bold' : 'dim'}>{entry.text}</span>
              )}
            </span>
            {entry.rank !== null && entry.band && (
              <span
                className="mono bold"
                style={{ fontSize: 12.5, color: bandColor(entry.band), flex: 'none' }}
              >
                {formatRank(entry.rank)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Round banner
 * ------------------------------------------------------------------ */

export function RoundBanner({ room }: { room: RoomState }) {
  return (
    <div className="row row--wrap" style={{ gap: 6 }}>
      {/* Today's daily played together runs on the co-op rules, but nobody set
          it up and it is not a custom game. Naming it for the daily is the only
          place that difference shows on this strip. */}
      <span className="chip chip--brand">
        {room.dailyCoop ? 'Daily co-op' : modeLabel(room.mode)}
      </span>
      {room.totalRounds > 1 && (
        <span className="chip">
          Round {room.round} of {room.totalRounds}
        </span>
      )}
      {room.settings.ranked && <span className="chip chip--accent">Ranked</span>}
      {room.teamGuessesLeft !== null && (
        <span className="chip chip--live">{room.teamGuessesLeft} team guesses left</span>
      )}
      <span className="chip">{room.settings.difficulty}</span>
    </div>
  );
}
