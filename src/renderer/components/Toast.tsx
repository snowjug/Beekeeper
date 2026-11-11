import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { toastVariants } from '@renderer/motion/variants';
import { Icon, type IconName } from './Icon';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastInput {
  title: string;
  message?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** Auto-dismiss delay; 0 keeps the toast until dismissed. Default 4000 ms. */
  durationMs?: number;
}

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
  durationMs: number;
}

interface ToastState {
  toasts: ToastItem[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_VISIBLE = 3;
let counter = 0;

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (input) => {
    counter += 1;
    const id = `toast-${Date.now().toString(36)}-${counter}`;
    const item: ToastItem = {
      id,
      title: input.title,
      tone: input.tone ?? 'info',
      durationMs: input.durationMs ?? 4000,
      ...(input.message ? { message: input.message } : {}),
      ...(input.action ? { action: input.action } : {}),
    };
    set((state) => ({ toasts: [...state.toasts, item].slice(-MAX_VISIBLE) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export function showToast(input: ToastInput): string {
  return useToastStore.getState().push(input);
}

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'info',
  success: 'check',
  warning: 'warning',
  error: 'error',
};

const TONE_COLOR: Record<ToastTone, string> = {
  info: 'text-accent-text',
  success: 'text-success',
  warning: 'text-accent-text',
  error: 'text-danger',
};

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const paused = useRef(false);

  useEffect(() => {
    if (toast.durationMs <= 0) return undefined;
    let remaining = toast.durationMs;
    let last = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!paused.current) remaining -= now - last;
      last = now;
      if (remaining <= 0) onDismiss(toast.id);
    }, 200);
    return () => window.clearInterval(timer);
  }, [toast.id, toast.durationMs, onDismiss]);

  return (
    <motion.div
      layout
      variants={toastVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onPointerEnter={() => {
        paused.current = true;
      }}
      onPointerLeave={() => {
        paused.current = false;
      }}
      className="bk-glass pointer-events-auto flex w-[min(420px,92vw)] items-start gap-3 rounded-card px-4 py-3 text-fg"
    >
      <span className={`mt-0.5 ${TONE_COLOR[toast.tone]}`}>
        <Icon name={TONE_ICON[toast.tone]} size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.message ? <p className="mt-0.5 text-[13px] text-fg-muted">{toast.message}</p> : null}
      </div>
      {toast.action ? (
        <button
          type="button"
          className="rounded-control px-2.5 py-1 text-[13px] font-semibold text-accent-text hover:bg-raised"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss notification"
        className="rounded-full p-1 text-fg-faint hover:bg-raised hover:text-fg"
        onClick={() => onDismiss(toast.id)}
      >
        <Icon name="close" size={14} />
      </button>
    </motion.div>
  );
}

export interface ToastHostProps {
  /** Positioning classes; defaults to bottom-centre. */
  className?: string;
}

/** Renders the global toast stack. Mount once per renderer. */
export function ToastHost({
  className = 'fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2',
}: ToastHostProps) {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);
  return (
    <div className={`pointer-events-none ${className}`} role="region" aria-label="Notifications">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
