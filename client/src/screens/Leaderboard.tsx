import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import {
  GAME_MODES,
  RANK_TIERS,
  modeSupportsRanked,
  tierForRating,
  type LeaderboardRow,
} from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { RankBadge, RoleBadge } from '../components/RankBadge';
import { Avatar, EmptyState, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { modeLabel, percent } from '../lib/format';
import { play, unlockAudio } from '../lib/sound';
import { useStore } from '../lib/store';

type Metric = 'rating' | 'wins' | 'xp' | 'streak' | 'wordsFound';
type Scope = 'global' | 'guild';

const METRIC_LABEL: Record<Metric, string> = {
  rating: 'Elo',
  xp: 'XP',
  wins: 'Wins',
  streak: 'Streak',
  wordsFound: 'Words',
};

const METRICS = Object.keys(METRIC_LABEL) as Metric[];

/* One clause each — these sit inline beside the switcher, so anything longer
   than a few words wraps the toolbar and pushes the table below the fold.
   They also have to be true: Elo is per-mode (the select picks the ladder),
   and the streak column is bestStreak, i.e. the longest run of wins. */
const METRIC_CAPTION: Record<Metric, string> = {
  rating: 'elo, one ladder per ranked mode',
  xp: 'every mode counted',
  wins: 'first-place finishes',
  streak: 'best run of wins',
  wordsFound: 'words found, all time',
};

/* Elo is only ever written for the modes that support ranked play, so the
   other six ladders are permanently empty. Listing them would be six dead
   options in the select. */
const RANKED_MODES = GAME_MODES.filter(modeSupportsRanked);

/* Column geometry, shared by the header row and every player row. */
const RANK_W = 24;
const VALUE_W = 62;

/* The list scrolls inside itself rather than growing the page, so the
   switchers stay put and 50 rows still fit a 640px-tall window. The Elo board
   also carries the tier legend, so it gets the shorter cap. */
const LIST_MAX = 'clamp(200px, calc(100vh - 210px), 560px)';
const LIST_MAX_TIERS = 'clamp(180px, calc(100vh - 254px), 520px)';

/* Audio never starts on its own, so the unlock rides along with the first
   real press instead of firing on mount. */
function tap() {
  unlockAudio();
  play('click');
}

/**
 * Rows never travel without the query that produced them.
 *
 * The old board is deliberately left on screen while the next one loads, so
 * the layout does not collapse on every switch. That only works if the render
 * reads the loaded query rather than the selected one — otherwise picking Elo
 * would, for the length of one request, draw tier chips off XP totals and put
 * the whole board in Lexicon.
 */
interface Board {
  metric: Metric;
  scope: Scope;
  ladder: string | null;
  rows: LeaderboardRow[];
}

export function Leaderboard() {
  const ctx = useStore((s) => s.ctx);
  const [metric, setMetric] = useState<Metric>('xp');
  const [scope, setScope] = useState<Scope>('global');
  const [mode, setMode] = useState<string>('duel');
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  const guildId = ctx?.guildId ?? null;
  /* The scope switcher only exists inside a guild. Without this, a stale
     'guild' choice would keep asking for a server board after the Discord
     context went away, and the server would quietly answer with global rows. */
  const activeScope: Scope = guildId ? scope : 'global';
  const ranked = metric === 'rating';
  /* Only the Elo board is per-mode, so changing the mode on any other board
     must not refetch. */
  const ladder = ranked ? mode : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api
      .leaderboard({
        metric,
        scope: activeScope,
        mode: ladder ?? undefined,
        guildId: activeScope === 'guild' ? guildId : undefined,
        limit: 50,
      })
      .then((res) => {
        if (cancelled) return;
        setBoard({ metric, scope: activeScope, ladder, rows: res.rows });
      })
      .catch(() => {
        if (cancelled) return;
        // A failed request must not look like an empty board.
        setBoard(null);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric, activeScope, ladder, guildId, reloads]);

  const firstLoad = loading && !board;
  /* Tiers belong to the rows on screen, not to the button that was just
     pressed. See the Board comment. */
  const showTiers = board?.metric === 'rating';

  /* The viewer's tier comes off their own row, not off the stored user: the
     legend then marks where they stand on the ladder being looked at, which
     is the only rating on screen. */
  const myValue = showTiers ? board?.rows.find((r) => r.isMe)?.value : undefined;
  const myTierId = myValue === undefined ? null : tierForRating(myValue).id;

  return (
    <div className="page" style={{ gap: 'var(--s3)' }}>
      {/* Title, all three switchers and the caption share one wrapping row. */}
      <div className="row row--wrap" style={{ gap: 'var(--s2) var(--s3)' }}>
        <h1 style={{ fontSize: 20 }}>Leaderboard</h1>

        <Segmented
          value={metric}
          onChange={(next: Metric) => {
            tap();
            setMetric(next);
          }}
          options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
        />

        {ranked && (
          <select
            className="select"
            aria-label="Ladder mode"
            value={mode}
            onChange={(e) => {
              tap();
              setMode(e.target.value);
            }}
          >
            {RANKED_MODES.map((m) => (
              <option key={m} value={m}>
                {modeLabel(m)}
              </option>
            ))}
          </select>
        )}

        {guildId && (
          <Segmented
            value={activeScope}
            onChange={(next: Scope) => {
              tap();
              setScope(next);
            }}
            options={[
              { value: 'global', label: 'Everyone' },
              { value: 'guild', label: 'This server' },
            ]}
          />
        )}

        <span
          className="faint thin truncate grow"
          style={{ fontSize: 12.5 }}
          title={METRIC_CAPTION[metric]}
        >
          {METRIC_CAPTION[metric]}
        </span>

        {/* Reloading an already-drawn board dims it in place; swapping in the
            big spinner would collapse the list and jump the layout. */}
        {loading && board && <Spinner size={13} />}
      </div>

      {/* Tier legend. Only the Elo board puts tiers on its rows, so only the
          Elo board explains them. Nine chips reading name plus entry rating
          say it faster than a sentence would — and at the tightened padding
          they hold a single row inside the 880px page. */}
      {ranked && (
        <div className="row row--wrap" style={{ gap: 'var(--s1)' }}>
          {RANK_TIERS.map((tier) => {
            const mine = tier.id === myTierId;
            return (
              <span
                key={tier.id}
                className="chip"
                style={{
                  height: 20,
                  padding: '0 var(--s1)',
                  fontSize: 11,
                  color: tier.color,
                  /* Outlined by default so nine chips do not read as nine
                     buttons. The viewer's own tier is the one filled in. */
                  background: mine ? 'var(--surface-2)' : 'transparent',
                  border: `1px solid ${mine ? 'currentColor' : 'var(--line)'}`,
                }}
                title={
                  mine
                    ? `${tier.name}, your tier — from ${tier.minRating} elo`
                    : `${tier.name} — from ${tier.minRating} elo`
                }
              >
                <ModeIcon name={tier.icon} size={10} />
                {tier.name}
                {/* Dimmed by opacity rather than a token so the number keeps
                    the tier's hue, the way RankBadge dims its own rating. */}
                <span className="mono" style={{ opacity: 0.7 }}>
                  {tier.minRating}
                </span>
              </span>
            );
          })}
        </div>
      )}

      {firstLoad ? (
        <div className="row" role="status" style={{ justifyContent: 'center', padding: 'var(--s6)' }}>
          <Spinner size={18} />
        </div>
      ) : failed ? (
        <div className="col" style={{ alignItems: 'center', gap: 'var(--s2)' }}>
          <EmptyState
            icon={<ModeIcon name="trophy" size={22} />}
            title="The board did not load"
            hint="probably the connection."
          />
          <button
            className="btn btn--sm"
            onClick={() => {
              tap();
              setReloads((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : board && board.rows.length > 0 ? (
        <motion.ol
          key={`${board.metric}:${board.scope}:${board.ladder ?? ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: loading ? 0.45 : 1 }}
          transition={{ duration: 0.16 }}
          className="col"
          style={{
            margin: 0,
            padding: 0,
            gap: 1,
            listStyle: 'none',
            maxHeight: ranked ? LIST_MAX_TIERS : LIST_MAX,
            overflowY: 'auto',
          }}
        >
          {/* The column header rides inside the scroller: it then shares the
              rows' content box, so the value column stays aligned whether or
              not a scrollbar is taking width. */}
          <li
            className="row eyebrow"
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              gap: 'var(--s2)',
              padding: '0 var(--s2) var(--s1)',
              background: 'var(--bg)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <span style={{ width: RANK_W, flex: 'none', textAlign: 'right' }}>#</span>
            <span className="grow">Player</span>
            <span style={{ width: VALUE_W, flex: 'none', textAlign: 'right' }}>
              {METRIC_LABEL[board.metric]}
            </span>
          </li>

          {board.rows.map((row) => {
            const top = row.rank <= 3;
            return (
              <li
                key={row.user.id}
                className="row"
                style={{
                  gap: 'var(--s2)',
                  padding: 'var(--s1) var(--s2)',
                  borderRadius: 'var(--r-sm)',
                  background: row.isMe ? 'var(--surface-2)' : undefined,
                }}
              >
                <span
                  className="mono"
                  style={{
                    width: RANK_W,
                    flex: 'none',
                    textAlign: 'right',
                    fontSize: 12.5,
                    fontWeight: top ? 'var(--w-bold)' : 'var(--w-normal)',
                    color: top ? 'var(--text)' : 'var(--text-faint)',
                  }}
                >
                  {row.rank}
                </span>

                <Avatar user={row.user} size={20} />

                {/* Name, badges, title and record ride on one line: a second
                    line per row costs more height than the header and the
                    switchers together. Both badges sit here unwrapped — they
                    render nothing in the common case, and a null child costs
                    no flex gap, which a wrapper element around them would. */}
                <div className="row grow" style={{ gap: 'var(--s2)', minWidth: 0 }}>
                  <span className="truncate" style={{ fontSize: 13 }}>
                    {row.user.displayName}
                  </span>

                  <RoleBadge user={row.user} />

                  {/* The value column two cells over already prints the
                      number, so the chip carries the tier name alone. Its own
                      tooltip still spells out the rating. */}
                  {showTiers && <RankBadge rating={row.value} size="sm" showRating={false} />}

                  {row.isMe && (
                    <span className="faint thin" style={{ fontSize: 11.5, flex: 'none' }}>
                      you
                    </span>
                  )}
                  {row.user.title && (
                    <span
                      className="chip chip--brand truncate"
                      style={{ height: 19, fontSize: 11, maxWidth: showTiers ? 96 : 130 }}
                    >
                      {row.user.title}
                    </span>
                  )}
                </div>

                {row.matches > 0 && (
                  <span
                    className="faint thin mono"
                    style={{ fontSize: 11, flex: 'none' }}
                    title={`${row.matches} matches, ${row.wins} won, ${percent(row.winRate)} win rate`}
                  >
                    {row.matches}m · {percent(row.winRate)}
                  </span>
                )}

                <span
                  className="mono bold"
                  style={{ minWidth: VALUE_W, flex: 'none', textAlign: 'right', fontSize: 13.5 }}
                >
                  {row.value.toLocaleString()}
                </span>
              </li>
            );
          })}
        </motion.ol>
      ) : (
        <EmptyState
          icon={<ModeIcon name="trophy" size={22} />}
          title={activeScope === 'guild' ? 'Nobody from this server yet' : 'Nobody on this board yet'}
          hint={
            ranked
              ? `ratings show up after a ranked ${modeLabel(mode)} match.`
              : 'play a match and you are on it.'
          }
        />
      )}
    </div>
  );
}
