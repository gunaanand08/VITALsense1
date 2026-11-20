import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from '../../utils/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

/**
 * The signature control: a transparent pill with a 1px hairline outline.
 * Nothing is filled — filling a button is the one thing this language forbids.
 */
const BUTTON_BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-full border font-mono uppercase transition-colors duration-[140ms] disabled:cursor-not-allowed disabled:opacity-35';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-text text-text hover:bg-text hover:text-black',
  secondary: 'border-border-strong text-text-muted hover:border-text hover:text-text',
  ghost: 'border-transparent text-text-dim hover:text-text',
  danger: 'border-danger/70 text-danger hover:bg-danger/12',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-4 text-[9.5px] tracking-[0.2em]',
  md: 'h-10 px-6 text-[10.5px] tracking-[0.22em]',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" className={cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: ButtonVariant;
  active?: boolean;
}

export function IconButton({ label, variant = 'ghost', active, className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors duration-[140ms]',
        BUTTON_VARIANTS[variant],
        active ? 'border-text text-text' : 'border-transparent',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'danger' | 'idle';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-text-muted border-border-strong',
  accent: 'text-text border-border-strong',
  good: 'text-good border-good/40',
  warn: 'text-warn border-warn/40',
  danger: 'text-danger border-danger/45',
  idle: 'text-idle border-idle/35',
};

const TONE_DOT: Record<Tone, string> = {
  neutral: 'bg-text-dim',
  accent: 'bg-text',
  good: 'bg-good',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-idle',
};

/**
 * Status is type, not a filled chip: a tracked monospace label in a hairline box.
 * Nothing here is coloured for decoration — colour appears only for a state.
 */
export function Badge({
  tone = 'neutral',
  children,
  className,
  dot = false,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex h-[19px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 font-mono text-[9px] uppercase leading-none tracking-[0.16em]',
        TONE_TEXT[tone],
        className,
      )}
    >
      {dot && <span className={cx('h-1 w-1 rounded-full', TONE_DOT[tone])} />}
      {children}
    </span>
  );
}

export function StatusDot({ tone, pulse = false }: { tone: Tone; pulse?: boolean }) {
  return (
    <span className="relative flex h-1.5 w-1.5 shrink-0">
      {pulse && <span className={cx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-70', TONE_DOT[tone])} />}
      <span className={cx('relative inline-flex h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} />
    </span>
  );
}

export function Panel({
  children,
  className,
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article' | 'aside';
}) {
  return <Tag className={cx('relative border border-border bg-surface', className)}>{children}</Tag>;
}

export function PanelHeader({
  title,
  subtitle,
  actions,
  icon,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-mono text-[10px] font-normal uppercase tracking-[0.22em] text-text">
          {icon && <span className="text-text-dim">{icon}</span>}
          {title}
        </h2>
        {subtitle && <p className="mt-1 max-w-full truncate font-serif text-[12.5px] leading-snug text-text-dim">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const valueSize = size === 'lg' ? 'text-[42px] leading-[0.92]' : size === 'sm' ? 'text-[17px]' : 'text-[26px]';
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : tone === 'idle'
            ? 'text-idle'
            : 'text-text';
  return (
    <div className={cx('min-w-0', className)}>
      <div className="label-mono">{label}</div>
      <div className="mt-1.5 flex items-baseline gap-1.5">
        <span className={cx('font-mono font-normal tnum tracking-[0.01em]', valueSize, toneClass)}>{value}</span>
        {unit && <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-dim">{unit}</span>}
      </div>
      {hint && <div className="mt-1 truncate font-serif text-[12px] text-text-dim">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-text-dim">{icon}</div>}
      <h3 className="display text-[18px]">{title}</h3>
      <p className="max-w-sm font-serif text-[13.5px] leading-relaxed text-text-dim">{description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse border border-border bg-surface-2', className)} />;
}

export function InlineCode({ children }: { children: ReactNode }) {
  return (
    <code className="border border-border px-1.5 py-0.5 font-mono text-[11px] tracking-[0.04em] text-text-muted">
      {children}
    </code>
  );
}
