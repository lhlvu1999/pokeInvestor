"use client";

/**
 * Portfolio chat UI. Keeps message history client-side (no persistence),
 * POSTs the full transcript to /api/ask each turn, renders the reply +
 * a collapsible trace of the LLM's SQL queries so the user can see what
 * was actually run.
 */

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
type Trace = {
  query: string;
  ok: boolean;
  rowCount?: number;
  truncated?: boolean;
  error?: string;
};
type Message = {
  role: Role;
  content: string;
  trace?: Trace[];
};

const SUGGESTIONS = [
  "What did I spend most on this year?",
  "Which held items had the most bearish creator mentions in the last 60 days?",
  "Top 5 items by realized profit",
  "How many items do I hold in each tag?",
  "Which creators mention my held items most?",
];

export function ChatUI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, pending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    const next: Message[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setPending(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(({ role, content }) => ({ role, content })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply, trace: data.trace },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  function reset() {
    setMessages([]);
    setError(null);
    setInput("");
  }

  return (
    <div className="flex flex-col gap-4 h-[calc(100vh-14rem)] max-w-4xl">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 flex flex-col gap-4"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Ask anything about your portfolio. The model can run read-only SQL
              against your database. Try:
            </div>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {pending && (
          <div className="text-xs text-zinc-500 italic">
            Thinking… (local models take 10–30s)
          </div>
        )}
        {error && (
          <div className="text-sm rounded border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-2 text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask about your portfolio…  (Shift+Enter for newline)"
          rows={2}
          className="flex-1 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-zinc-300 dark:focus:ring-zinc-700"
        />
        <div className="flex flex-col gap-2">
          <button
            type="submit"
            disabled={pending || input.trim().length === 0}
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-50"
          >
            {pending ? "…" : "Ask"}
          </button>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="text-xs text-zinc-500 hover:underline"
            >
              Reset
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div
      className={`flex flex-col gap-1.5 ${isUser ? "items-end" : "items-start"}`}
    >
      <div
        className={`rounded-lg px-3 py-2 text-sm max-w-full whitespace-pre-wrap ${
          isUser
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800"
        }`}
      >
        {message.content}
      </div>
      {message.trace && message.trace.length > 0 && (
        <TraceView trace={message.trace} />
      )}
    </div>
  );
}

function TraceView({ trace }: { trace: Trace[] }) {
  const [open, setOpen] = useState(false);
  const errored = trace.some((t) => !t.ok);
  return (
    <div className="text-[10px]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`uppercase tracking-wider hover:underline ${
          errored
            ? "text-rose-500 dark:text-rose-400"
            : "text-zinc-500 dark:text-zinc-400"
        }`}
      >
        {open ? "Hide" : "Show"} {trace.length} SQL call
        {trace.length === 1 ? "" : "s"}
        {errored && " (with errors)"}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-2">
          {trace.map((t, i) => (
            <div
              key={i}
              className={`rounded p-2 font-mono text-[11px] ${
                t.ok
                  ? "bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800"
                  : "bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900"
              }`}
            >
              <pre className="whitespace-pre-wrap break-words">{t.query}</pre>
              <div className="mt-1 text-[10px] text-zinc-500">
                {t.ok
                  ? `${t.rowCount} row${t.rowCount === 1 ? "" : "s"}${t.truncated ? " (truncated)" : ""}`
                  : `Error: ${t.error}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
