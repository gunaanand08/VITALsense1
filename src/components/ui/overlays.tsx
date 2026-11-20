import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore } from '../../state/store';
import { cx } from '../../utils/format';
import { Button, IconButton } from './primitives';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 460,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="w-full border border-border-strong bg-black focus:outline-none"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
          <div>
            <h2 id="modal-title" className="display text-[17px]">
              {title}
            </h2>
            {description && <p className="mt-2 font-serif text-[13px] leading-relaxed text-text-muted">{description}</p>}
          </div>
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={13} aria-hidden />
          </IconButton>
        </div>
        {children && <div className="px-6 py-5">{children}</div>}
        {footer && <div className="flex justify-end gap-3 border-t border-border px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

const TOAST_ICON = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const TOAST_TONE = {
  info: 'border-idle/45 text-idle',
  success: 'border-good/45 text-good',
  warning: 'border-warn/45 text-warn',
  danger: 'border-danger/50 text-danger',
};

export function ToastViewport() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed right-4 top-[72px] z-[60] flex w-[min(360px,calc(100vw-32px))] flex-col gap-2"
    >
      {toasts.map((toast) => {
        const Icon = TOAST_ICON[toast.tone];
        return (
          <div
            key={toast.id}
            className={cx('pointer-events-auto flex items-start gap-3 border bg-black px-4 py-3', TOAST_TONE[toast.tone])}
          >
            <Icon size={14} aria-hidden className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-text">{toast.title}</p>
              {toast.message && (
                <p className="mt-1 break-words font-serif text-[12.5px] leading-relaxed text-text-muted">{toast.message}</p>
              )}
            </div>
            <IconButton label="Dismiss notification" onClick={() => dismiss(toast.id)} className="h-6 w-6">
              <X size={11} aria-hidden />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
}
