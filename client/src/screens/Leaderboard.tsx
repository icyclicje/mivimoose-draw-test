import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { GAME_MODES, type LeaderboardRow } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { Avatar, EmptyState, Segmented, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { modeLabel, percent } from '../lib/format';
import { useStore } from '../lib/store';

type Metric = 'rating' | 'wins' | 'xp' | 'streak' | 'wordsFound';

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
  rating: 'elo, one ladder per mode',
  xp: 'every mode counted',
  wins: 'first-place finishes',
  streak: 'best run of wins',
  wordsFound: 'words found, all time',
};

/* Column geometry, shared by the header row and every player row. */
const RANK_W = 24;
const VALUE_W = 62;

/* The list scrolls inside itself rather than growing the page, so the
   switchers stay put and 50 rows still fit a 640px-tall window. */
const LIST_MAX = 'clamp(200px, calc(100vh - 210px), 560px)';

export function Leaderboard() {
  const ctx = useStore((s) => s.ctx);
  const [metric, setMetric] = useState<Metric>('xp');
  const [scope, setScope] = useState<'global' | 'guild'>('global');
  const [mode, setMode] = useState('duel');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);

  const guildId = ctx?.guildId ?? null;
  /* The scope switcher only exists inside a guild. Without this, a stale
     'guild' choice would keep asking for a server board after the Discord
     context went away, and the server would quietly answer with global rows. */
  const activeScope = guildId ? scope : 'global';
  /* Only the Elo board is per-mode, so changing the mode on any other board
     must not refetch. */
  const ladder = metric === 'rating' ? mode : undefined;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api
      .leaderboard({
        metric,
        scope: activeScope,
        mode: ladder,
        guildId: activeScope === 'guild' ? guildId : undefined,
        limit: 50,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.rows);
      })
      .catch(() => {
        if (cancelled) return;
        // A failed request must not look like an empty board.
        setRows([]);
        setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metric, activeScope, ladder, guildId, reloads]);

  const firstLoad = loading && rows.length === 0;

  return (
    <div className="page" style={{ gap: 'var(--s3)' }}>
      {/* Title, all three switchers and the caption share one wrapping row. */}
      <div className="row row--wrap" style={{ gap: 'var(--s2) var(--s3)' }}>
        <h1 style={{ fontSize: 20 }}>Leaderboard</h1>

        <Segmented
          value={metric}
          onChange={setMetric}
          options={METRICS.map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
        />

        {metric === 'rating' && (
          <select
            className="select"
            aria-label="Ladder mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {GAME_MODES.map((m) => (
              <option key={m} value={m}>
                {modeLabel(m)}
              </option>
            ))}
          </select>
        )}

        {guildId && (
          <Segmented
            value={activeScope}
            onChange={setScope}
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
        {loading && rows.length > 0 && <Spinner size={13} />}
      </div>

      {firstLoad ? (
        <div className="row" style={{ justifyContent: 'center', padding: 'var(--s6)' }}>
          <Spinner size={18} />
        </div>
      ) : failed ? (
        <div className="col" style={{ alignItems: 'center', gap: 'var(--s2)' }}>
          <EmptyState
            icon={<ModeIcon name="trophy" size={22} />}
            title="The board did not load"
            hint="probably the connection."
          />
          <button className="btn btn--sm" onClick={() => setReloads((n) => n + 1)}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<ModeIcon name="trophy" size={22} />}
          title="Nobody on this board yet"
          hint="play a match and it is yours to lose."
        />
      ) : (
        <motion.ol
          key={`${metric}:${activeScope}:${ladder ?? ''}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: loading ? 0.45 : 1 }}
          transition={{ duration: 0.16 }}
          className="col"
          style={{
            margin: 0,
            padding: 0,
            gap: 1,
            listStyle: 'none',
            maxHeight: LIST_MAX,
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
              {METRIC_LABEL[metric]}
            </span>
          </li>

          {rows.map((row) => {
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
                    fontSize: 13,
                    fontWeight: top ? 800 : 600,
                    color: top ? 'var(--text)' : 'var(--text-faint)',
                  }}
                >
                  {row.rank}
                </span>

                <Avatar user={row.user} size={22} />

                {/* Name, title and record ride on one line: a second line per
                    row costs more height than the header and switchers together. */}
                <div className="row grow" style={{ gap: 'var(--s2)', minWidth: 0 }}>
                  <span className="truncate" style={{ fontSize: 13.5 }}>
                    {row.user.displayName}
                  </span>
                  {row.isMe && (
                    <span className="faint thin" style={{ fontSize: 11.5, flex: 'none' }}>
                      you
                    </span>
                  )}
                  {row.user.title && (
                    <span
                      className="chip chip--brand truncate"
                      style={{ height: 19, fontSize: 11, maxWidth: 130 }}
                    >
                      {row.user.title}
                    </span>
                  )}
                </div>

                {row.matches > 0 && (
                  <span
                    className="faint thin mono"
                    style={{ fontSize: 11.5, flex: 'none' }}
                    title={`${row.matches} matches, ${row.wins} won, ${percent(row.winRate)} win rate`}
                  >
                    {row.matches}m · {percent(row.winRate)}
                  </span>
                )}

                <span
                  className="mono bold"
                  style={{ minWidth: VALUE_W, flex: 'none', textAlign: 'right', fontSize: 14 }}
                >
                  {row.value.toLocaleString()}
                </span>
              </li>
            );
          })}
        </motion.ol>
      )}
    </div>
  );
}
