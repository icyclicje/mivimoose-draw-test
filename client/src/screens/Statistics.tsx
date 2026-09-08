import { useEffect, useMemo, useState } from 'react';
import type { ServerStats, StatsRange } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { EmptyState, Panel, Segmented, Spinner } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { relativeTime } from '../lib/format';
import { play, unlockAudio } from '../lib/sound';

const RANGE_OPTIONS: { value: StatsRange; label: string }[] = [
  { value: 'day', label: '24 hours' },
  { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' },
];

/* Chart furniture, in pixels: a gutter wide enough for four-digit counts and a
   plot tall enough to read a spike. These are drawing geometry, not spacing
   between elements, so they are not on the spacing scale. */
const Y_GUTTER = 44;
const PLOT_H = 200;
const X_LABEL_H = 18;

/* Gridlines at 0, 25, 50, 75 and 100 percent of the top of the scale. */
const GRID = [0, 0.25, 0.5, 0.75, 1];

/* Five x labels no matter how many samples there are. One tick per point would
   be 72 overlapping timestamps. */
const X_TICKS = 5;

/* Candidate gridline steps, smallest first. 2.5 earns its place: without it a
   max of 100 rounds up to a top of 200 and the line sits flat across the
   bottom half of the plot. */
const STEPS = [1, 2, 2.5, 5, 10];

/**
 * A top-of-scale that divides into four whole numbers.
 *
 * The gridlines are labelled with their values, so a raw max of 37 would put
 * "9.25" on a line. Rounding the ceiling up to the next nice step keeps every
 * label an integer. That is what the isInteger guard is for: it stops 2.5 from
 * being picked at the small end where it would label a line "2.5 players".
 */
function scaleTop(rawMax: number): number {
  if (rawMax <= 4) return 4;
  const quarter = rawMax / 4;
  const power = Math.pow(10, Math.floor(Math.log10(quarter)));
  const norm = quarter / power;
  const step = STEPS.find((s) => norm <= s && Number.isInteger(s * power)) ?? 10 * power;
  return step * 4;
}

function tickLabel(t: number, range: StatsRange): string {
  const d = new Date(t);
  if (range === 'day') return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (range === 'week') return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The tooltip stamp: enough to place the sample exactly, and no more. */
function exactTime(t: number, range: StatsRange): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (range === 'day') return time;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`;
}

/**
 * One series as an SVG path inside a 0..100 square.
 *
 * The paths live in a viewBox stretched to the plot box, so every coordinate
 * here is a percentage rather than a pixel.
 */
function seriesPath(values: number[], xs: number[], top: number, filled: boolean): string {
  if (values.length === 0) return '';
  const y = (v: number) => (100 - (Math.min(v, top) / top) * 100).toFixed(2);

  // A single sample is still worth drawing. A flat line reads as "this is the
  // level"; one invisible vertex reads as a broken chart.
  if (values.length === 1) {
    const only = y(values[0]);
    return filled ? `M0,${only} L100,${only} L100,100 L0,100 Z` : `M0,${only} L100,${only}`;
  }

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(2)},${y(v)}`).join(' ');
  return filled ? `${line} L100,100 L0,100 Z` : line;
}

function Dot({ color }: { color: string }) {
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, flex: 'none' }} />;
}

function Metric({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  title?: string;
}) {
  return (
    <div className="col" style={{ gap: 1 }} title={title}>
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
      {sub && (
        <span className="faint thin truncate" style={{ fontSize: 11.5 }}>
          {sub}
        </span>
      )}
    </div>
  );
}

export function Statistics() {
  const [range, setRange] = useState<StatsRange>('day');
  const [stats, setStats] = useState<ServerStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setHover(null);
    api
      .stats(range)
      .then((res) => {
        if (!cancelled) setStats(res);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // 403 is the normal answer for most accounts, not a fault, so it gets a
        // plain explanation rather than the retry-and-apologise treatment.
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          setStats(null);
          return;
        }
        setFailed(true);
        setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, reloads]);

  const points = useMemo(() => stats?.points ?? [], [stats]);

  const chart = useMemo(() => {
    const top = scaleTop(points.reduce((m, p) => Math.max(m, p.online, p.inGame), 0));
    const xs = points.map((_, i) => (points.length > 1 ? (i * 100) / (points.length - 1) : 50));
    const online = points.map((p) => p.online);
    const inGame = points.map((p) => p.inGame);

    const ticks: number[] = [];
    // Guarded: with no samples the interpolation below runs negative and the
    // label row would index past the start of the array.
    for (let k = 0; k < X_TICKS && points.length > 0; k += 1) {
      const idx = Math.round((k * (points.length - 1)) / (X_TICKS - 1));
      // Fewer samples than ticks collapses several of these onto one point.
      if (!ticks.includes(idx)) ticks.push(idx);
    }

    return {
      top,
      xs,
      ticks,
      onlineLine: seriesPath(online, xs, top, false),
      onlineArea: seriesPath(online, xs, top, true),
      inGameLine: seriesPath(inGame, xs, top, false),
      inGameArea: seriesPath(inGame, xs, top, true),
    };
  }, [points]);

  const pick = (next: StatsRange) => {
    // Nothing else on this screen makes noise, so the first click is where
    // audio gets its gesture.
    unlockAudio();
    play('click');
    setRange(next);
  };

  const reload = () => {
    unlockAudio();
    play('click');
    setReloads((n) => n + 1);
  };

  if (forbidden) {
    return (
      <div className="page page--narrow">
        <EmptyState
          icon={<ModeIcon name="shield" size={22} />}
          title="Moderators only"
          hint="Server traffic is visible to the moderator team. Nothing else on your account is affected."
        />
      </div>
    );
  }

  const hovered = hover !== null ? points[hover] : undefined;
  const tooltipLow = hovered ? hovered.online > chart.top / 2 : false;

  /* Labels follow the range the samples actually came from, not the button
     that was just pressed. The previous range's points stay on screen while
     the next fetch runs, and stamping 24 hours of samples with dates for that
     second is simply wrong. */
  const axisRange = stats?.range ?? range;

  return (
    <div className="page" style={{ gap: 'var(--s3)' }}>
      <div className="row row--wrap" style={{ gap: 'var(--s2) var(--s3)' }}>
        <h1 style={{ fontSize: 20 }}>Server stats</h1>
        <Segmented value={range} options={RANGE_OPTIONS} onChange={pick} disabled={loading && !stats} />
        <span className="grow" />
        {/* Reloading a drawn page dims nothing and jumps nothing; the spinner
            just says the numbers are on their way. */}
        {loading && stats && <Spinner size={13} />}
        <button className="btn btn--ghost btn--sm" onClick={reload} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && !stats ? (
        <div className="row" style={{ justifyContent: 'center', padding: 'var(--s6)' }}>
          <Spinner size={18} />
        </div>
      ) : failed || !stats ? (
        <div className="col" style={{ alignItems: 'center', gap: 'var(--s2)' }}>
          <EmptyState
            icon={<ModeIcon name="chart" size={22} />}
            title="The stats did not load"
            hint="Check the connection and try again."
          />
          <button className="btn btn--sm" onClick={reload}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <Panel>
            <div className="metrics">
              <Metric
                label="Online now"
                value={stats.current.online.toLocaleString()}
                sub={`${stats.current.inGame.toLocaleString()} in game · ${stats.current.rooms.toLocaleString()} rooms`}
              />
              <Metric
                label="Peak online"
                value={stats.peak.online.toLocaleString()}
                sub={stats.peak.online > 0 ? relativeTime(stats.peak.at) : 'nothing recorded yet'}
                // With no peak the server sends at: 0, and an exact-time
                // tooltip reading "1/1/1970" is worse than no tooltip.
                title={stats.peak.online > 0 ? new Date(stats.peak.at).toLocaleString() : undefined}
              />
              <Metric
                label="Players"
                value={stats.totals.players.toLocaleString()}
                sub="accounts, all time"
              />
              <Metric
                label="Matches"
                value={stats.totals.matches.toLocaleString()}
                sub="finished games"
              />
              <Metric
                label="Guesses"
                value={stats.totals.guesses.toLocaleString()}
                sub={`${stats.totals.wordsFound.toLocaleString()} words found`}
              />
            </div>
          </Panel>

          <Panel
            title="Concurrent players"
            action={
              <div className="row faint thin" style={{ gap: 'var(--s3)', fontSize: 12 }}>
                <span className="row" style={{ gap: 'var(--s1)' }}>
                  <Dot color="var(--accent)" /> Online
                </span>
                <span className="row" style={{ gap: 'var(--s1)' }}>
                  <Dot color="var(--green)" /> In game
                </span>
              </div>
            }
          >
            {points.length === 0 ? (
              <EmptyState
                icon={<ModeIcon name="clock" size={22} />}
                title="No samples yet"
                hint="The server records a headcount every few minutes. The line fills in as they arrive."
              />
            ) : (
              <div style={{ paddingLeft: Y_GUTTER }}>
                <div
                  style={{ position: 'relative', height: PLOT_H, cursor: 'crosshair' }}
                  onMouseMove={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    if (box.width === 0) return;
                    // Nearest point to the pointer's x. At 72 samples a
                    // per-point hit target is a few pixels wide, so hovering
                    // "a point" has to mean hovering the column it sits in.
                    const ratio = (e.clientX - box.left) / box.width;
                    const idx = Math.round(ratio * (points.length - 1));
                    const next = Math.min(points.length - 1, Math.max(0, idx));
                    // Most moves stay inside the same column; re-rendering the
                    // chart on every one of them for no visible change is the
                    // easiest way to make a hover feel heavy.
                    setHover((prev) => (prev === next ? prev : next));
                  }}
                  onMouseLeave={() => setHover(null)}
                >
                  {/* Gridlines and their labels are plain DOM, not SVG. The
                      paths below are stretched to fill this box, and any text
                      inside that stretch would be stretched with it. */}
                  {GRID.map((f) => (
                    <div
                      key={f}
                      style={{ position: 'absolute', left: 0, right: 0, top: `${(1 - f) * 100}%` }}
                    >
                      <div
                        style={{
                          borderTop: `1px solid var(${f === 0 ? '--line-strong' : '--line'})`,
                        }}
                      />
                      <span
                        className="faint mono"
                        style={{
                          position: 'absolute',
                          right: 'calc(100% + var(--s2))',
                          top: 0,
                          transform: 'translateY(-50%)',
                          fontSize: 11,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {Math.round(chart.top * f).toLocaleString()}
                      </span>
                    </div>
                  ))}

                  <svg
                    width="100%"
                    height="100%"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    style={{ display: 'block', position: 'relative' }}
                    role="img"
                    aria-label={`Concurrent players over the selected range. Peak ${stats.peak.online} online.`}
                  >
                    {/* In game is drawn first, so the online line stays on top
                        of it wherever the two meet. Both strokes opt out of the
                        viewBox scaling, or the vertical stretch would thicken
                        them unevenly. */}
                    <path d={chart.inGameArea} fill="var(--green-soft)" />
                    <path
                      d={chart.inGameLine}
                      fill="none"
                      stroke="var(--green)"
                      strokeWidth={1.6}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path d={chart.onlineArea} fill="var(--accent-soft)" />
                    <path
                      d={chart.onlineLine}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth={1.8}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>

                  {hovered && hover !== null && (
                    <>
                      <div
                        style={{
                          position: 'absolute',
                          top: 0,
                          bottom: 0,
                          left: `${chart.xs[hover]}%`,
                          width: 1,
                          background: 'var(--line-strong)',
                          pointerEvents: 'none',
                        }}
                      />

                      {/* Markers are positioned divs rather than SVG circles:
                          a circle in a non-uniform viewBox is an oval. */}
                      {[
                        { value: hovered.inGame, color: 'var(--green)' },
                        { value: hovered.online, color: 'var(--accent)' },
                      ].map((series) => (
                        <div
                          key={series.color}
                          style={{
                            position: 'absolute',
                            left: `${chart.xs[hover]}%`,
                            top: `${(1 - Math.min(series.value, chart.top) / chart.top) * 100}%`,
                            width: 8,
                            height: 8,
                            marginLeft: -4,
                            marginTop: -4,
                            borderRadius: '50%',
                            background: series.color,
                            border: '1px solid var(--surface)',
                            pointerEvents: 'none',
                          }}
                        />
                      ))}

                      <div
                        className="col"
                        style={{
                          position: 'absolute',
                          left: `${chart.xs[hover]}%`,
                          // Slides from left-aligned at the start of the plot to
                          // right-aligned at the end, so the box never hangs off
                          // either edge.
                          transform: `translateX(-${chart.xs[hover]}%)`,
                          // Sits opposite the line: a high reading pins it low.
                          top: tooltipLow ? undefined : 'var(--s2)',
                          bottom: tooltipLow ? 'var(--s2)' : undefined,
                          gap: 'var(--s1)',
                          padding: 'var(--s2)',
                          borderRadius: 'var(--r-sm)',
                          background: 'var(--surface-2)',
                          border: '1px solid var(--line-strong)',
                          fontSize: 12,
                          whiteSpace: 'nowrap',
                          pointerEvents: 'none',
                        }}
                      >
                        <span className="faint">{exactTime(hovered.t, axisRange)}</span>
                        <span className="row" style={{ gap: 'var(--s1)' }}>
                          <Dot color="var(--accent)" />
                          <span className="mono bold">{hovered.online.toLocaleString()}</span> online
                        </span>
                        <span className="row" style={{ gap: 'var(--s1)' }}>
                          <Dot color="var(--green)" />
                          <span className="mono bold">{hovered.inGame.toLocaleString()}</span> in game
                        </span>
                        <span className="faint thin">
                          {hovered.rooms.toLocaleString()} {hovered.rooms === 1 ? 'room' : 'rooms'}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* X labels sit outside the stretched svg for the same reason
                    the y labels do. */}
                <div style={{ position: 'relative', height: X_LABEL_H }}>
                  {chart.ticks.map((idx, k) => (
                    <span
                      key={idx}
                      className="faint mono"
                      style={{
                        position: 'absolute',
                        top: 3,
                        left: `${chart.xs[idx]}%`,
                        // The end labels are pulled inside the plot rather than
                        // centred on their tick, which would clip them.
                        transform:
                          k === 0
                            ? 'none'
                            : k === chart.ticks.length - 1
                              ? 'translateX(-100%)'
                              : 'translateX(-50%)',
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {tickLabel(points[idx].t, axisRange)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
