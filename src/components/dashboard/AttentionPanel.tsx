import Link from "next/link";
import { Card } from "@/components/ui";
import type { AttentionItem, AttentionTone } from "@/lib/calc/attention";

const DOT: Record<AttentionTone, string> = {
  warn: "bg-amber-500",
  info: "bg-sky-500",
  good: "bg-emerald-500",
};

/**
 * "What needs me?" — a short, actionable list. Deliberately empty when
 * there's nothing to do: a quiet "all clear" is real information, and an
 * always-full panel trains you to stop reading it.
 */
export function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-200/80 dark:border-zinc-800 flex items-center justify-between">
        <h2 className="font-medium text-sm">Needs attention</h2>
        {items.length > 0 && (
          <span className="text-[11px] tabular-nums rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 px-2 py-0.5">
            {items.length}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <div className="px-4 py-6 flex items-center gap-3">
          <span
            aria-hidden
            className="size-2 rounded-full bg-emerald-500 shrink-0"
          />
          <div>
            <div className="text-sm font-medium">All clear</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Nothing is waiting on you right now.
            </div>
          </div>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
          {items.map((item) => (
            <li key={item.key}>
              <Link
                href={item.href}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 rounded-full shrink-0 ${DOT[item.tone]}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium leading-snug">
                    {item.title}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5 leading-snug">
                    {item.detail}
                  </div>
                </div>
                <span className="text-xs text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-100 whitespace-nowrap mt-0.5 transition-colors">
                  {item.cta} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
