import { useState } from 'react';
import { motion } from 'framer-motion';
import { Logo } from '../components/Logo';
import { Spinner } from '../components/ui';
import { isEmbedded } from '../lib/discord';
import { useStore } from '../lib/store';

export function Boot() {
  const status = useStore((s) => s.status);
  const bootMessage = useStore((s) => s.bootMessage);
  const error = useStore((s) => s.error);
  const bootGuest = useStore((s) => s.bootGuest);
  const [name, setName] = useState('');

  // Inside Discord the Activity handshake runs on its own. Everywhere else the
  // guest door is the way in, and it is offered immediately rather than as a
  // fallback after something fails.
  const showGuest = !isEmbedded && (status === 'auth' || status === 'error');

  return (
    <div
      className="col"
      style={{
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 24 }}
      >
        <Logo size={92} animated full />
      </motion.div>

      <div className="col" style={{ alignItems: 'center', gap: 8, textAlign: 'center' }}>
        <h1 style={{ fontSize: 30, letterSpacing: '0.01em' }}>
          MIVIMOOSE<span style={{ color: 'var(--brand)' }}> GUESS</span>
        </h1>
        <p className="dim thin" style={{ margin: 0, maxWidth: 380, fontSize: 15 }}>
          Find the secret word. Every guess comes back ranked by how close it is.
        </p>
      </div>

      {error && !showGuest && (
        <div
          className="panel"
          style={{ padding: '14px 18px', maxWidth: 400, textAlign: 'center' }}
        >
          <div style={{ marginBottom: 4, color: 'var(--pink)' }}>Could not start</div>
          <div className="dim thin" style={{ fontSize: 13 }}>
            {error}
          </div>
        </div>
      )}

      {showGuest ? (
        <form
          className="col"
          style={{ gap: 10, width: 'min(360px, 100%)' }}
          onSubmit={(e) => {
            e.preventDefault();
            void bootGuest(name);
          }}
        >
          <input
            className="input input--word"
            style={{ textAlign: 'center' }}
            placeholder="pick a name"
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <button className="btn btn--primary btn--lg btn--block" type="submit">
            Play as guest
          </button>
          <p className="faint thin" style={{ margin: 0, fontSize: 12.5, textAlign: 'center' }}>
            No account needed. Open a second tab to play against yourself, or send
            someone a room code and play against them.
          </p>
          {error && (
            <p style={{ margin: 0, fontSize: 12.5, textAlign: 'center', color: 'var(--pink)' }}>
              {error}
            </p>
          )}
        </form>
      ) : (
        !error && (
          <div className="row dim" style={{ gap: 9, fontSize: 13.5 }}>
            <Spinner />
            {bootMessage || 'Loading'}
          </div>
        )
      )}
    </div>
  );
}
