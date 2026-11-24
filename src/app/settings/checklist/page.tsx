export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { progress } from "@/lib/calc/checklist";
import { getChecklist } from "@/lib/server/checklist";

const MARK = {
  todo: { glyph: "○", cls: "text-amber-600 dark:text-amber-400", label: "To do" },
  ok: { glyph: "✓", cls: "text-emerald-600 dark:text-emerald-400", label: "Done" },
  info: { glyph: "i", cls: "text-zinc-400", label: "Note" },
} as const;

/**
 * The things only you can do, worked out from your data, so this list stays
 * current and shows when it is finished.
 */
export default async function ChecklistPage() {
  const items = await getChecklist();
  const { done, total } = progress(items);
  return (
    <div className="flex flex-col gap-5 max-w-2xl">
      <div>
        <Link href="/settings" className="text-sm text-zinc-500 hover:underline">
          ← Settings
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Setup checklist</h1>
        <p className="text-xs text-zinc-500 mt-1 leading-relaxed max-w-prose">
          {done === total
            ? "Everything is done."
            : `${done} of ${total} done. These are the things the app can't do for you; each one checks itself against your data, so it ticks off when you have dealt with it.`}
        </p>
      </div>
      <Card className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {items.map((it) => {
          const m = MARK[it.state];
          return (
            <div key={it.key} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-0.5 w-4 shrink-0 text-center font-semibold ${m.cls}`} aria-label={m.label}>
                {m.glyph}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${it.state === "ok" ? "text-zinc-500" : ""}`}>{it.title}</div>
                {it.detail && <p className="text-xs text-zinc-500 leading-relaxed mt-0.5">{it.detail}</p>}
              </div>
              {it.href && it.cta && (
                <Link href={it.href} className="shrink-0 text-xs font-medium text-sky-700 dark:text-sky-400 hover:underline">
                  {it.cta}
                </Link>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
