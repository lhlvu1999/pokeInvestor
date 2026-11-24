"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * "⋯ More" overflow menu for the rarely-used and destructive actions on a
 * page, so they sit one deliberate click away from the everyday buttons.
 *
 * The panel stays open while you interact inside it (a merge picker, for
 * instance, is a small form, not a one-shot menu item) and closes on
 * outside click or Escape.
 */
export function MoreMenu({
  children,
  label = "More actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center rounded-md w-10 h-10 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <span aria-hidden className="text-lg leading-none tracking-tighter">
          ⋯
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-20 w-72 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg p-1 flex flex-col"
        >
          {children}
        </div>
      )}
    </div>
  );
}
