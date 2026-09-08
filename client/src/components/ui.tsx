import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PublicUser } from '@mivimoose/shared';
import { cx, initials } from '../lib/format';
import { useStore } from '../lib/store';

/* ------------------------------------------------------------------ *
 * Avatar
 * ------------------------------------------------------------------ */

export function Avatar({
  user,
  size = 32,
  ring,
}: {
  user: Pick<PublicUser, 'displayName' | 'avatarUrl'>;
  size?: number;
  ring?: string;
}) {
  const style = {
    width: size,
    height: size,
    borderRadius: Math.max(5, size * 0.28),
    flex: 'none' as const,
    boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
  };

  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt="" style={{ ...style, objectFit: 'cover', display: 'block' }} />;
  }
  return (
    <div
      style={{
        ...style,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--surface-3)',
        fontSize: size * 0.36,
        fontWeight: 700,
        color: 'var(--text-dim)',
      }}
    >
      {initials(user.displayName)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClass,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={cx('panel', className)}>
      {(title || action) && (
        <header className="panel__head">
          <div className="grow">
            {title && <h3>{title}</h3>}
            {subtitle && (
              <div className="faint" style={{ fontSize: 12.5 }}>
                {subtitle}
              </div>
            )}
          </div>
          {action}
        </header>
      )}
      <div className={cx('panel__body', bodyClass)}>{children}</div>
    </section>
  );
}

/** A titled group with no box around it — for pages that already have enough boxes. */
export function Section({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="col" style={{ gap: 'var(--s3)' }}>
      <div className="row row--between">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div style={{ padding: '28px 16px', textAlign: 'center' }}>
      {icon && <div style={{ marginBottom: 10, opacity: 0.5 }}>{icon}</div>}
      <div style={{ marginBottom: 3 }}>{title}</div>
      {hint && (
        <div className="faint" style={{ fontSize: 13, maxWidth: 320, margin: '0 auto' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        display: 'inline-block',
        border: '2px solid var(--surface-3)',
        borderTopColor: 'var(--text)',
        borderRadius: '50%',
        animation: 'spin 0.7s linear infinite',
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Form controls
 * ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
  disabled,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="col" style={{ gap: 5, opacity: disabled ? 0.45 : 1 }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      {children}
      {hint && (
        <span className="faint thin" style={{ fontSize: 12, lineHeight: 1.4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className="row"
      style={{
        width: '100%',
        gap: 12,
        padding: '9px 11px',
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-2)',
        textAlign: 'left',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <span className="grow col" style={{ gap: 1 }}>
        <span style={{ fontSize: 13.5 }}>{label}</span>
        {hint && (
          <span className="faint thin" style={{ fontSize: 12 }}>
            {hint}
          </span>
        )}
      </span>
      <span
        style={{
          width: 34,
          height: 20,
          flex: 'none',
          borderRadius: 'var(--r-pill)',
          padding: 2,
          background: checked ? 'var(--accent)' : 'var(--surface-3)',
          transition: 'background 0.16s',
        }}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 560, damping: 34 }}
          style={{
            display: 'block',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            marginLeft: checked ? 14 : 0,
          }}
        />
      </span>
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  const id = options.map((o) => o.value).join();
  return (
    <div
      className="row"
      style={{
        gap: 2,
        padding: 3,
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-2)',
        opacity: disabled ? 0.45 : 1,
        overflowX: 'auto',
      }}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            style={{
              position: 'relative',
              flex: 1,
              height: 28,
              minWidth: 'fit-content',
              padding: '0 10px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: active ? 800 : 600,
              color: active ? '#fff' : 'var(--text-dim)',
              whiteSpace: 'nowrap',
            }}
          >
            {active && (
              <motion.span
                layoutId={`seg-${id}`}
                transition={{ type: 'spring', stiffness: 520, damping: 40 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 4,
                  background: 'var(--accent)',
                  zIndex: -1,
                }}
              />
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled,
  format,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (next: number) => void;
  disabled?: boolean;
  format?: (v: number) => string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div
      className="row"
      style={{
        gap: 0,
        borderRadius: 'var(--r-sm)',
        background: 'var(--surface-2)',
        overflow: 'hidden',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(clamp(value - step))}
        style={{ width: 34, height: 34, color: 'var(--text-dim)', fontSize: 18 }}
      >
        −
      </button>
      <div className="grow mono" style={{ textAlign: 'center', fontSize: 13.5 }}>
        {format ? format(value) : `${value}${suffix ?? ''}`}
      </div>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(clamp(value + step))}
        style={{ width: 34, height: 34, color: 'var(--text-dim)', fontSize: 18 }}
      >
        +
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
            background: 'rgba(8, 12, 22, 0.8)',
          }}
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            onClick={(e) => e.stopPropagation()}
            className="panel"
            style={{
              width: '100%',
              maxWidth: width,
              maxHeight: '88vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <header className="panel__head">
              <h3 className="grow">{title}</h3>
              <button className="btn btn--ghost btn--sm" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </header>
            <div className="panel__body" style={{ overflowY: 'auto' }}>
              {children}
            </div>
            {footer && (
              <footer
                className="row"
                style={{
                  padding: 'var(--s3) var(--s4)',
                  borderTop: '1px solid var(--line)',
                  justifyContent: 'flex-end',
                  gap: 8,
                }}
              >
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

const TOAST_ACCENT: Record<string, string> = {
  info: 'var(--accent)',
  success: 'var(--green)',
  warn: 'var(--orange)',
  error: 'var(--pink)',
};

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 80,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
        width: 'min(420px, calc(100vw - 32px))',
      }}
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 500, damping: 38 }}
            onClick={() => dismiss(toast.id)}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 14px',
              borderRadius: 'var(--r)',
              background: 'var(--surface-2)',
              border: '1px solid var(--line-strong)',
              textAlign: 'left',
              fontSize: 13.5,
            }}
          >
            <span
              style={{
                width: 3,
                alignSelf: 'stretch',
                borderRadius: 'var(--r-pill)',
                background: TOAST_ACCENT[toast.kind],
                flex: 'none',
              }}
            />
            <span className="grow">{toast.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Misc
 * ------------------------------------------------------------------ */

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useStore((s) => s.toast);
  return (
    <button
      className="btn btn--sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          toast('success', 'Copied');
        } catch {
          toast('warn', `Copy this: ${value}`);
        }
      }}
    >
      {label}
    </button>
  );
}
