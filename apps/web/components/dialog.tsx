'use client';

import { motion } from 'motion/react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal dialog: labelled by its title, closes with the Close button, Escape or a click on the backdrop (all
 * ignored while `busy`, so a request in flight cannot be abandoned half way), keeps Tab inside, locks page
 * scroll, and returns focus to whatever opened it. Render it inside `AnimatePresence` for the exit animation.
 */
export function Dialog({ title, onClose, busy = false, children }: { title: string; onClose: () => void; busy?: boolean; children: ReactNode }) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // Latest values for the one document-level key handler, so it is attached once.
  const live = useRef({ onClose, busy });
  live.current = { onClose, busy };

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const items = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    // First field of the form (the Close button is the first focusable, so skip it when there is something else).
    (items()[1] ?? items()[0] ?? panel.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!live.current.busy) live.current.onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = items();
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-fg/30 sm:items-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !busy && onClose()}
    >
      <motion.div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-bg p-6 outline-none sm:rounded-3xl"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="font-display text-2xl">{title}</h2>
          <button
            type="button"
            className="-mr-2 -mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl leading-none text-muted hover:bg-fg/5 disabled:opacity-40"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  );
}
