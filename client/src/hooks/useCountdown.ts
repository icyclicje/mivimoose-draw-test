import { useEffect, useState } from 'react';

/**
 * Milliseconds remaining until `deadline`, corrected for clock skew between the
 * player's machine and the server. Ticks at 10Hz while running and stops dead
 * at zero so it never renders a negative clock.
 */
export function useCountdown(deadline: number | null, clockOffset = 0): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (deadline === null) {
      setRemaining(null);
      return;
    }
    const tick = () => setRemaining(Math.max(0, deadline - (Date.now() + clockOffset)));
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [deadline, clockOffset]);

  return remaining;
}
