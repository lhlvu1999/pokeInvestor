"use client";

/**
 * Global toast provider. Shows a stack of dismissible toasts in the
 * bottom-right; each toast can carry an "Undo" action that fires a
 * callback and dismisses. Kept intentionally minimal — no framework,
 * no animation library.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastKind = "info" | "success" | "error";

export type Toast = {
  id: number;
  message: string;
  kind: ToastKind;
  /** Auto-dismiss after this many ms. `null` = sticky until user closes. */
  durationMs: number | null;
  action?: {
    label: string;
    onClick: () => void | Promise<void>;
  };
};

type ToastInput = Omit<Toast, "id" | "kind" | "durationMs"> & {
  kind?: ToastKind;
  durationMs?: number | null;
};

type Ctx = {
  show: (t: ToastInput) => number;
  dismiss: (id: number) => void;
};

const ToastCtx = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    const toast: Toast = {
      id,
      message: input.message,
      kind: input.kind ?? "info",
      durationMs: input.durationMs === undefined ? 5000 : input.durationMs,
      action: input.action,
    };
    setToasts((prev) => [...prev, toast]);
    return id;
  }, []);

  return (
    <ToastCtx.Provider value={{ show, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 items-end pointer-events-none">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (toast.durationMs == null) return;
    const h = setTimeout(onDismiss, toast.durationMs);
    return () => clearTimeout(h);
  }, [toast.durationMs, onDismiss]);

  const kindClass = {
    info: "bg-zinc-900 text-zinc-100 dark:bg-zinc-100 dark:text-zinc-900",
    success:
      "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
    error: "bg-rose-600 text-white dark:bg-rose-500 dark:text-rose-950",
  }[toast.kind];

  return (
    <div
      role="status"
      className={`pointer-events-auto min-w-[240px] max-w-sm rounded shadow-lg text-sm px-3 py-2 flex items-center gap-3 ${kindClass}`}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={async () => {
            try {
              await toast.action?.onClick();
            } finally {
              onDismiss();
            }
          }}
          className="text-xs font-semibold uppercase tracking-wider underline decoration-2 underline-offset-2 hover:no-underline"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="text-xs opacity-70 hover:opacity-100"
        aria-label="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}
