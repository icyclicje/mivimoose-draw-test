import { useState } from 'react';
import { motion } from 'framer-motion';
import type { MatchResultEntry, RoomState } from '@mivimoose/shared';
import { ModeIcon } from '../components/ModeIcon';
import { Avatar, EmptyState, Section, Spinner } from '../components/ui';
import { formatDuration, formatRank, modeLabel, ordinal } from '../lib/format';
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

export function Results({ room }: { room: RoomState }) {
  const user = useStore((s) => s.user);
  const rematch = useStore((s) => s.rematch);
  const leaveRoom = useStore((s) => s.leaveRoom);

  // One round open at a time: the recap stays a list, and a 20-round marathon
  // can't shove the standings off screen by unfolding everything at once.
  // Declared above the early return so the hook order never changes.
  const [openRound, setOpenRound] = useState<number | null>(null);

  const result = room.result;
  const isHost = room.hostId === user?.id;

  if (!result) {
    return (
      <div className="page">
        <EmptyState icon={<Spinner size={20} />} title="Tallying up" hint="Scoring the last round." />
      </div>
    );
  }

  // The server sorts entries by placement before sending them, so [0] is the winner.
  const winner = result.entries[0];
  const mine = result.entries.find((e) => e.playerId === user?.id);
  const myDelta = mine ? ratingDelta(mine) : null;

  return (
    <div className="page" style={{ gap: 'var(--s4)' }}>
      {/* ---------------------------------------------------------- hero
          Winner, your own line and the two exits on one band. The centred
          column this replaces pushed the standings off a 640px-tall screen. */}
      <motion.header
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 28 }}
        className="panel row row--wrap"
        style={{ gap: 'var(--s3)', padding: 'var(--s3) var(--s4)' }}
      >
        {winner && (
          <Avatar user={{ displayName: winner.displayName, avatarUrl: winner.avatarUrl }} size={38} />
        )}

        <div className="grow col" style={{ gap: 1, minWidth: 150 }}>
          <div className="row" style={{ gap: 'var(--s2)', minWidth: 0 }}>
            <h2 className="truncate">{winner ? `${winner.displayName} wins` : 'No winner'}</h2>
            <span className="chip chip--brand">{modeLabel(result.mode)}</span>
          </div>

          <div className="row row--wrap" style={{ gap: 'var(--s2)', fontSize: 13 }}>
            {mine ? (
              <>
                <span className="dim">
                  you finished {ordinal(mine.placement)} · {mine.score.toLocaleString()} pts
                </span>
                {mine.xpGained > 0 && <span className="faint mono">+{mine.xpGained} xp</span>}
                {myDelta !== null && (
                  <span className="mono" style={{ color: deltaColor(myDelta) }}>
                    {signed(myDelta)} elo
                  </span>
                )}
              </>
            ) : (
              <span className="dim">you watched this one</span>
            )}
            <span className="faint thin">
              {result.entries.length} players · {result.rounds.length} rounds
            </span>
          </div>
        </div>

        <div className="row" style={{ gap: 'var(--s2)', flex: 'none' }}>
          {/* The server rejects a rematch from anyone but the host, so it is
              disabled rather than hidden — a vanished button just reads as a
              bug to everyone who isn't hosting. */}
          <button
            className="btn btn--primary"
            onClick={rematch}
            disabled={!isHost}
            title={isHost ? undefined : 'only the host can call a rematch'}
          >
            <ModeIcon name="bolt" size={15} />
            Rematch
          </button>
          <button className="btn" onClick={leaveRoom}>
            Back to menu
          </button>
        </div>
      </motion.header>

      {/* ---------------------------------------------------------- table */}
      <Section title="Standings">
        <div className="col" style={{ gap: 'var(--s1)' }}>
          {result.entries.map((entry, i) => {
            const delta = ratingDelta(entry);
            const isMe = entry.playerId === user?.id;
            const stats =
              `${entry.wordsFound} found · ${entry.totalGuesses} guesses · best ${formatRank(entry.bestRank)}` +
              (entry.xpGained > 0 ? ` · +${entry.xpGained} xp` : '');
            return (
              <motion.div
                key={entry.playerId}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.2) }}
                className="row"
                style={{
                  gap: 'var(--s2)',
                  padding: '5px var(--s2)',
                  borderRadius: 'var(--r-sm)',
                  background: isMe ? 'var(--accent-soft)' : 'var(--surface-2)',
                  border: `1px solid ${isMe ? 'var(--accent)' : 'transparent'}`,
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

                {/* Name and stats share one line — stacking them doubled the row
                    height for something that fits beside the name. */}
                <span className="truncate" style={{ fontSize: 14, flex: '0 1 auto' }}>
                  {entry.displayName}
                </span>
                <span className="grow faint thin truncate" style={{ fontSize: 12 }} title={stats}>
                  {stats}
                </span>

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
              </motion.div>
            );
          })}
        </div>
      </Section>

      {/* ---------------------------------------------------------- rounds */}
      <Section title="Rounds" action={<span className="faint thin">open one for the breakdown</span>}>
        {/* Marathon runs to 20 rounds. Cap the list rather than let it push the
            standings and the exits off the page. */}
        <div className="col" style={{ gap: 'var(--s1)', maxHeight: 250, overflowY: 'auto' }}>
          {result.rounds.map((round) => {
            const solvers = round.entries.filter((e) => e.foundAt !== null);
            const solvedBy = solvers.length
              ? `found by ${solvers.map((s) => s.displayName).join(', ')}`
              : 'nobody found it';
            // Three near words say why the secret was hard; the full list turned
            // every row into a paragraph.
            const near = round.neighbours.slice(0, 3);
            const open = openRound === round.round;
            return (
              <div
                key={round.round}
                className="col"
                style={{
                  flex: 'none',
                  borderRadius: 'var(--r-sm)',
                  background: 'var(--surface-2)',
                  overflow: 'hidden',
                }}
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenRound(open ? null : round.round)}
                  className="row"
                  style={{ width: '100%', gap: 'var(--s2)', padding: '4px var(--s2)', textAlign: 'left' }}
                >
                  <span
                    style={{
                      flex: 'none',
                      display: 'flex',
                      color: 'var(--text-faint)',
                      transform: open ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.14s',
                    }}
                  >
                    <ModeIcon name="chevron" size={12} />
                  </span>

                  <span className="mono faint" style={{ width: 12, flex: 'none', fontSize: 12 }}>
                    {round.round}
                  </span>

                  <span className="bold truncate" style={{ minWidth: 80, fontSize: 14 }}>
                    {round.secret}
                  </span>

                  <span className="grow dim thin truncate" style={{ fontSize: 12.5 }} title={solvedBy}>
                    {solvedBy}
                  </span>

                  {round.eliminated.length > 0 && (
                    <span className="mono" style={{ fontSize: 11.5, flex: 'none', color: 'var(--pink)' }}>
                      {round.eliminated.length} out
                    </span>
                  )}

                  {/* Ranks ride on the chip instead of a tooltip — most of these
                      players are on a phone in Discord and never get a hover. */}
                  {near.map((n) => (
                    <span key={n.word} className="chip" style={{ height: 19, fontSize: 11, flex: 'none' }}>
                      {n.word}
                      <span className="mono faint">{formatRank(n.rank)}</span>
                    </span>
                  ))}
                </button>

                {/* The per-player detail the compact row drops: points, guesses,
                    solve time and who went out. */}
                {open && (
                  <div className="col" style={{ gap: 1, padding: '0 var(--s2) var(--s2) 30px' }}>
                    {round.entries.map((e) => {
                      const isMe = e.playerId === user?.id;
                      return (
                        <div
                          key={e.playerId}
                          className="row"
                          style={{
                            gap: 'var(--s2)',
                            padding: '2px var(--s2)',
                            borderRadius: 'var(--r-sm)',
                            fontSize: 12.5,
                            background: isMe ? 'var(--accent-soft)' : 'transparent',
                          }}
                        >
                          <span className="mono faint" style={{ width: 24, flex: 'none' }}>
                            {ordinal(e.placement)}
                          </span>
                          <span className="grow truncate">{e.displayName}</span>
                          {round.eliminated.includes(e.playerId) && (
                            <span style={{ flex: 'none', color: 'var(--pink)' }}>out</span>
                          )}
                          <span className="mono faint" style={{ flex: 'none' }}>
                            {e.guessCount}g
                          </span>
                          {/* Solve time if they got it, otherwise how close they got. */}
                          <span
                            className="mono"
                            style={{
                              flex: 'none',
                              minWidth: 44,
                              textAlign: 'right',
                              color: e.foundAt !== null ? 'var(--green)' : 'var(--text-faint)',
                            }}
                          >
                            {e.foundAt !== null ? formatDuration(e.foundAt) : formatRank(e.bestRank)}
                          </span>
                          <span
                            className="mono bold"
                            style={{ flex: 'none', minWidth: 40, textAlign: 'right' }}
                          >
                            +{e.points}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
