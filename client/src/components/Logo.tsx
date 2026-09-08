/**
 * Mivi — the Mivimoose Guess mascot.
 *
 * The character *is* the question mark: the hook is his head, the eyes sit on
 * the crown of the curve, the stem is his body and the dot beneath is his feet.
 * Everything is drawn as one thick round-capped stroke so he stays legible when
 * shrunk to a 16px favicon, where the arms and mouth drop out automatically.
 */

interface LogoProps {
  size?: number;
  /** Adds arms and a mouth. Auto-enabled above 40px. */
  full?: boolean;
  /** Idle bob and blink. */
  animated?: boolean;
  className?: string;
  title?: string;
}

export function Logo({ size = 32, full, animated = false, className, title = 'Mivimoose Guess' }: LogoProps) {
  const detailed = full ?? size >= 40;
  const uid = `mivi-${size}-${detailed ? 'f' : 's'}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      className={className}
      role="img"
      aria-label={title}
      style={animated ? { animation: 'float-y 4.2s ease-in-out infinite' } : undefined}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={`${uid}-body`} x1="20%" y1="0%" x2="80%" y2="100%">
          <stop offset="0%" stopColor="#ffd992" />
          <stop offset="46%" stopColor="#ffb020" />
          <stop offset="100%" stopColor="#e08a06" />
        </linearGradient>
        <linearGradient id={`${uid}-shine`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Arms first so they tuck behind the body rather than crossing it. They
          splay down and out from the stem, well clear of the hook above. */}
      {detailed && (
        <g fill="none" stroke={`url(#${uid}-body)`} strokeWidth={10} strokeLinecap="round">
          <path d="M59 75 C50 77 45 82 43 89" />
          <path d="M69 77 C78 79 83 84 85 91" />
        </g>
      )}

      {/* Head and body: the question-mark hook, curling into a short stem. */}
      <g
        fill="none"
        stroke={`url(#${uid}-body)`}
        strokeWidth={20}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M36 46 C36 26 52 15 68 19 C84 23 92 38 83 51 C76 61 65 62 64 74 L64 82" />
      </g>

      {/* Highlight along the crown, which is what stops the amber reading flat. */}
      <path
        d="M40 42 C41 26 54 17 68 20"
        fill="none"
        stroke={`url(#${uid}-shine)`}
        strokeWidth={5}
        strokeLinecap="round"
      />

      {/* Feet: the question mark's dot, squared off so he has something to stand on. */}
      <rect x="54" y="97" width="20" height="20" rx="7" fill={`url(#${uid}-body)`} />

      {/* Face, sitting on the crown of the hook. The whole face has to live
          inside the 20px stroke, so the eyes ride high and the mouth tucks just
          above the stroke's lower edge — drop it any further and it detaches
          into the counter of the glyph. */}
      <g style={animated ? { animation: 'blink 5.5s ease-in-out infinite', transformOrigin: '64px 20px' } : undefined}>
        <ellipse cx="54.5" cy="19.5" rx="5.3" ry="5.7" fill="#241601" />
        <ellipse cx="73" cy="21" rx="5.3" ry="5.7" fill="#241601" />
        <circle cx="56" cy="17.8" r="1.8" fill="#fff8e8" />
        <circle cx="74.5" cy="19.3" r="1.8" fill="#fff8e8" />
      </g>

      {detailed && (
        <path
          d="M59.5 26.4 Q64 29.6 68.5 26.8"
          fill="none"
          stroke="#241601"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/** Wordmark used in the header. Set in caps, the way Contexto sets its own. */
export function Wordmark({ size = 28, animated = false }: { size?: number; animated?: boolean }) {
  return (
    <div className="app__brand">
      <Logo size={size} animated={animated} />
      <div className="app__wordmark">
        MIVIMOOSE<span> GUESS</span>
      </div>
    </div>
  );
}
