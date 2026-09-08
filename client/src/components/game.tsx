import { useEffect, useMemo, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { heatFraction, type FeedEntry, type GuessResult, type RoomPlayer, type RoomState } from '@mivimoose/shared';
import { bandColor, cx, formatClock, formatRank, modeLabel } from '../lib/format';
import { Avatar } from './ui';

/* ------------------------------------------------------------------ *
 * Guess row
 * ------------------------------------------------------------------ */

/**
 * One guess, built the way Contexto builds it: a flat track, a colour bar whose
 * width is `exp(-rank / tau)`, and the word and rank sitting on top.
 *
 * The bar spends almost the whole cold tail invisible and only starts moving
 * when you are genuinely close, which is what makes the last few guesses feel
 * like they matter.
 *
 * The one addition is the steal marker. When a word was already played by
 * someone else this round the row says who got there first — that is the whole
 * social mechanic of a duel, so it earns a place on the row itself.
 */
export function GuessRow({
  guess,
  pinned,
}: {
  guess: GuessResult;
  /** Rendered as the pinned copy above the list rather than inside it. */
  pinned?: boolean;
}) {
  const color = bandColor(guess.band);
  const found = guess.rank === 1;

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

        <span className="guess__word truncate">{guess.word}</span>

        {guess.isHint && (
          <span className="chip chip--accent" style={{ height: 19, fontSize: 10.5, flex: 'none' }}>
            hint
          </span>
        )}

        {guess.repeat && (
          <span
            className="truncate"
            style={{ fontSize: 12.5, color: 'var(--text-dim)', flex: '0 1 auto', minWidth: 0 }}
          >
            already guessed
          </span>
        )}


        <span className="guess__rank">{found ? 1 : formatRank(guess.rank)}</span>
      </div>
    </motion.li>
  );
}

/* ------------------------------------------------------------------ *
 * Guess list
 * ------------------------------------------------------------------ */

/**
 * The board: your latest guess held still at the top, and below it every guess
 * sorted closest-first.
 *
 * The pinned row is the point. Without it, playing a cold word sends it to the
 * bottom of a long list and you never see where it landed — so the answer to
 * "what did that do?" is always in the same place, and the list underneath is
 * left alone rather than scrolled around under you.
 */
export function GuessList({
  guesses,
  latestId,
  latestGuess,
  pulse = 0,
  emptyHint,
}: {
  guesses: GuessResult[];
  latestId?: string | null;
  /** The server's reply to the last submission, which is the only copy that
   *  carries `repeat`. Preferred over the stored row when the ids match. */
  latestGuess?: GuessResult | null;
  /** Changes on every submission so a repeated word still re-flashes. */
  pulse?: number;
  emptyHint?: string;
}) {
  const latest = useMemo(() => {
    if (!latestId) return undefined;
    if (latestGuess && latestGuess.id === latestId) return latestGuess;
    return guesses.find((g) => g.id === latestId);
  }, [guesses, latestId, latestGuess]);

  const sorted = useMemo(() => [...guesses].sort((a, b) => a.rank - b.rank), [guesses]);

  if (!guesses.length) {
    return (
      <div className="faint" style={{ padding: '24px 8px', textAlign: 'center', fontSize: 14 }}>
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
              pinned
            />
          </ul>
          {/* The pinned row also appears in the sorted list below. Without a
              divider the two identical rows read as a duplicate bug rather than
              "here is your last guess, and here is where it sits". */}
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
          {sorted.map((guess) => (
            <GuessRow
              key={guess.id}
              guess={guess}
            />
          ))}
        </AnimatePresence>
      </ul>
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
      <span className="chip chip--brand">{modeLabel(room.mode)}</span>
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
