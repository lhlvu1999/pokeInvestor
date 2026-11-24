"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Right-hand slide-over shared by the item drawer and the "What changed"
 * panel: dimmed backdrop, Escape / backdrop click to close, Tab kept inside
 * the panel, page scroll locked underneath, and a sticky header with a
 * close button that receives focus on open.
 *
 * The caller decides when it is mounted (render it only while open) and
 * restores focus to its trigger in `onClose`.
 */
export function SlideOver({
  label,
  ariaLabel,
  onClose,
  headerExtra,
  children,
}: {
  /** Small caps label in the sticky header. */
  label: string;
  /** Accessible name of the dialog. */
  ariaLabel: string;
  onClose: () => void;
  /** Rendered between the label and the close button. */
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40 drawer-fade"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="drawer-in absolute right-0 top-0 bottom-0 w-full sm:w-[26rem] bg-white dark:bg-zinc-900 border-l border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-y-auto"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-4 h-12 bg-white/95 dark:bg-zinc-900/95 backdrop-blur border-b border-zinc-200/80 dark:border-zinc-800">
          <span className="text-[11px] uppercase tracking-wider text-zinc-500 font-medium">
            {label}
          </span>
          <div className="flex items-center gap-2">
            {headerExtra}
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="w-8 h-8 rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            >
              <span aria-hidden className="text-lg leading-none">
                ×
              </span>
            </button>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
