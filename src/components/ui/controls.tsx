import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { useId } from 'react';
import { cx } from '../../utils/format';

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="label-mono">
        {label}
      </label>
      {children}
      {error ? (
        <p role="alert" className="font-serif text-[12px] text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="font-serif text-[12px] leading-relaxed text-text-dim">{hint}</p>
      )}
    </div>
  );
}

/** Inputs are underline-only: no box, no fill, no radius. */
const INPUT_CLASS =
  'h-10 w-full rounded-none border-0 border-b border-border-strong bg-transparent px-0 font-serif text-[15px] text-text placeholder:text-text-dim focus:border-b-text focus:outline-none';

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(INPUT_CLASS, className)} {...rest} />;
}

export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  step = 1,
  id,
  disabled,
  suffix,
}: {
  value: number;
  onValueChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  disabled?: boolean;
  suffix?: string;
}) {
  return (
    <div className="relative">
      <input
        id={id}
        type="number"
        className={cx(INPUT_CLASS, 'font-mono tracking-[0.02em] tnum', suffix && 'pr-12')}
        value={Number.isFinite(value) ? value : ''}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) {
            const clamped = Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, next));
            onValueChange(clamped);
          }
        }}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-text-dim">
          {suffix}
        </span>
      )}
    </div>
  );
}

export function Select({
  className,
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cx(INPUT_CLASS, 'appearance-none pr-6 font-serif text-[14px]', className)}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-5 py-2">
      <div className="min-w-0">
        <label htmlFor={id} className="block font-serif text-[14px] leading-snug text-text">
          {label}
        </label>
        {description && <p className="mt-1 font-serif text-[12px] leading-relaxed text-text-dim">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-1 h-4 w-10 shrink-0 border transition-colors duration-[140ms] disabled:opacity-35',
          checked ? 'border-text bg-text' : 'border-border-strong bg-transparent',
        )}
      >
        <span
          className={cx(
            'absolute top-1/2 h-2 w-2 -translate-y-1/2 transition-all duration-[140ms]',
            checked ? 'left-[22px] bg-black' : 'left-1 bg-text-dim',
          )}
        />
      </button>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="label-mono">
          {label}
        </label>
        <span className="font-mono text-[11px] tracking-[0.06em] tnum text-text">{format ? format(value) : value}</span>
      </div>
      <input
        id={id}
        type="range"
        className="h-1 w-full cursor-pointer appearance-none rounded-none bg-border-strong accent-white disabled:opacity-35"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-stretch border border-border">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              'relative h-8 px-3.5 font-mono text-[9.5px] uppercase tracking-[0.18em] transition-colors duration-[140ms]',
              selected ? 'text-text' : 'text-text-dim hover:text-text-muted',
            )}
          >
            {option.label}
            {selected && <span className="absolute inset-x-0 -bottom-px h-px bg-text" />}
          </button>
        );
      })}
    </div>
  );
}
