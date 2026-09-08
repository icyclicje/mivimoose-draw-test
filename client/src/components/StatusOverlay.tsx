import { AnimatePresence, motion } from 'framer-motion';
import type { StatusTone } from '@mivimoose/shared';
import { useStore } from '../lib/store';

/**
 * The running commentary over the board.
 *
 * Deliberately not a toast: toasts sit in a corner and demand a decision.
 * These sit just under the word box, in the path your eye already takes after
 * pressing Enter, and leave on their own. They are the difference between a
 * multiplayer round and nine people typing in silence.
 *
 * Only the newest two are shown. A ten-player lobby generates these faster than
 * anyone can read, and a stack of six is the same as none.
 */

const TONE: Record<StatusTone, { color: string; background: string }> = {
  neutral: { color: 'var(--text-dim)', background: 'var(--surface-2)' },
  good: { color: 'var(--green)', background: 'var(--green-soft)' },
  great: { color: 'var(--green)', background: 'var(--green-soft)' },
  warn: { color: 'var(--orange)', background: 'var(--orange-soft)' },
  rival: { color: 'var(--accent)', background: 'var(--accent-soft)' },
};

export function StatusOverlay() {
  const statuses = useStore((s) => s.statuses);
  const visible = [...statuses].sort((a, b) => b.priority - a.priority).slice(0, 2);

  return (
    <div
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--s1)',
        alignItems: 'center',
        // Holds its height so the board does not jump as lines come and go.
        minHeight: 26,
        maxWidth: '100%',
        minWidth: 0,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence initial={false}>
        {visible.map((message) => {
          const tone = TONE[message.tone] ?? TONE.neutral;
          return (
            <motion.div
              key={message.id}
              initial={{ opacity: 0, y: -6, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              style={{
                padding: '3px var(--s3)',
                borderRadius: 'var(--r-pill)',
                fontSize: 13,
                fontWeight: 'var(--w-bold)',
                color: tone.color,
                background: tone.background,
                // These name people ("Ada is now in the lead"), so a long
                // display name would otherwise widen the page rather than the
                // pill. One line still, just clipped at the board's width.
                whiteSpace: 'nowrap',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {message.text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
