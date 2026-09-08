import { nextTier, tierForRating, tierProgress, type PublicUser } from '@mivimoose/shared';
import { ModeIcon } from './ModeIcon';

/**
 * A rating, shown as something a person can feel.
 *
 * "1,347" tells you nothing on its own. "Tracker, 53 to Adept" tells you where
 * you are and what the next thing to chase is, which is the entire reason the
 * tiers exist.
 */
export function RankBadge({
  rating,
  size = 'md',
  showRating = true,
}: {
  rating: number;
  size?: 'sm' | 'md';
  showRating?: boolean;
}) {
  const tier = tierForRating(rating);
  const small = size === 'sm';

  return (
    <span
      className="chip"
      style={{
        gap: 'var(--s1)',
        height: small ? 20 : 24,
        color: tier.color,
        borderColor: 'currentColor',
        background: 'transparent',
      }}
      title={`${tier.name} · ${rating} Elo`}
    >
      <ModeIcon name={tier.icon} size={small ? 11 : 13} />
      <span style={{ fontWeight: 'var(--w-bold)' }}>{tier.name}</span>
      {showRating && (
        <span className="mono" style={{ opacity: 0.75 }}>
          {rating}
        </span>
      )}
    </span>
  );
}

/** The full block: tier, a bar through it, and what is next. */
export function RankProgress({ rating }: { rating: number }) {
  const tier = tierForRating(rating);
  const upcoming = nextTier(rating);
  const fraction = tierProgress(rating);

  return (
    <div className="col" style={{ gap: 'var(--s1)' }}>
      <div className="row" style={{ gap: 'var(--s2)' }}>
        <RankBadge rating={rating} />
        <span className="grow" />
        <span className="faint thin" style={{ fontSize: 12 }}>
          {upcoming
            ? `${upcoming.ratingNeeded} to ${upcoming.tier.name}`
            : 'top of the ladder'}
        </span>
      </div>
      <div
        style={{
          height: 5,
          borderRadius: 'var(--r-pill)',
          background: 'var(--surface-2)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${fraction * 100}%`,
            height: '100%',
            borderRadius: 'var(--r-pill)',
            background: tier.color,
            transition: 'width 0.6s cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      </div>
    </div>
  );
}

/** Moderator marker. Only rendered for accounts that actually have the role. */
export function RoleBadge({ user }: { user: Pick<PublicUser, 'role'> }) {
  if (user.role !== 'moderator' && user.role !== 'admin') return null;
  return (
    <span className="chip" style={{ height: 18, fontSize: 10, color: 'var(--brand)', gap: 3 }}>
      <ModeIcon name="shield" size={10} />
      {user.role === 'admin' ? 'admin' : 'mod'}
    </span>
  );
}
