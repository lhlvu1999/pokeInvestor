"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Checkbox } from "@/components/ui";
import { useToast } from "@/components/Toast";
import { saveCatalogLinks } from "@/lib/server/catalog_actions";
import type { LinkRow } from "@/lib/server/catalog_links";

/** What the person chose for one item. */
type Choice =
  { kind: "link"; productId: number } | { kind: "skip" } | { kind: "unlink" };

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function LinkReview({
  rows,
  sealedProducts,
  pricesAsOf,
}: {
  rows: LinkRow[];
  sealedProducts: number;
  pricesAsOf: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Confident matches start ticked; everything else starts undecided.
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const init: Record<string, Choice> = {};
    for (const r of rows) {
      if (r.status === "confident" && r.options[0])
        init[r.itemId] = { kind: "link", productId: r.options[0].productId };
    }
    return init;
  });

  const groups = useMemo(() => {
    const g = {
      confident: [] as LinkRow[],
      choose: [] as LinkRow[],
      none: [] as LinkRow[],
      setAside: [] as LinkRow[],
      linked: [] as LinkRow[],
    };
    for (const r of rows) {
      if (r.status === "confident") g.confident.push(r);
      else if (
        r.status === "ambiguous" ||
        r.status === "probable" ||
        r.status === "weak"
      )
        g.choose.push(r);
      else if (r.status === "none") g.none.push(r);
      else if (r.status === "linked") g.linked.push(r);
      else g.setAside.push(r); // not_sealed, skipped
    }
    return g;
  }, [rows]);

  const pendingChoices = Object.entries(choices);
  const set = (itemId: string, c: Choice | null) =>
    setChoices((prev) => {
      const next = { ...prev };
      if (c) next[itemId] = c;
      else delete next[itemId];
      return next;
    });

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveCatalogLinks({
        links: pendingChoices.map(([itemId, c]) => ({
          itemId,
          productId: c.kind === "link" ? c.productId : null,
          skip: c.kind === "skip",
        })),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setChoices({});
      router.refresh();
      const bits = [
        res.data.linked > 0 && `${res.data.linked} linked`,
        res.data.skipped > 0 &&
          `${res.data.skipped} marked not in the catalogue`,
        res.data.unlinked > 0 && `${res.data.unlinked} unlinked`,
      ].filter(Boolean);
      toast.show({ kind: "success", message: bits.join(", ") });
    });
  }

  const autoLinked = groups.linked.filter((r) => r.source === "auto");
  const manualLinked = groups.linked.filter((r) => r.source !== "auto");
  const linkedCount = groups.linked.length;
  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-zinc-500">
        {sealedProducts.toLocaleString()} sealed products in the catalogue
        {pricesAsOf &&
          `, prices from ${new Date(pricesAsOf).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`}
        . {linkedCount} of {rows.length} items linked.
      </p>

      {groups.confident.length > 0 && (
        <Section
          title="Looks right"
          hint="One clear match each, already ticked. Untick anything wrong."
        >
          {groups.confident.map((r) => (
            <Row key={r.itemId} row={r}>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={choices[r.itemId]?.kind === "link"}
                  onChange={(e) =>
                    set(
                      r.itemId,
                      e.target.checked
                        ? { kind: "link", productId: r.options[0].productId }
                        : null,
                    )
                  }
                />
                <Candidate o={r.options[0]} itemUsdCents={r.itemUsdCents} />
              </label>
            </Row>
          ))}
        </Section>
      )}

      {groups.choose.length > 0 && (
        <Section
          title="Needs your choice"
          hint="Several products fit, or the match isn't certain. Pick the right one, or none."
        >
          {groups.choose.map((r) => (
            <Row key={r.itemId} row={r}>
              <div className="flex flex-col gap-1.5">
                {r.options.map((o) => (
                  <label
                    key={o.productId}
                    className="flex items-start gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name={`pick-${r.itemId}`}
                      className="mt-1"
                      checked={
                        choices[r.itemId]?.kind === "link" &&
                        (choices[r.itemId] as { productId: number })
                          .productId === o.productId
                      }
                      onChange={() =>
                        set(r.itemId, { kind: "link", productId: o.productId })
                      }
                    />
                    <Candidate o={o} itemUsdCents={r.itemUsdCents} />
                  </label>
                ))}
                <label className="flex items-center gap-2 text-sm cursor-pointer text-zinc-500">
                  <input
                    type="radio"
                    name={`pick-${r.itemId}`}
                    checked={choices[r.itemId]?.kind === "skip"}
                    onChange={() => set(r.itemId, { kind: "skip" })}
                  />
                  None of these (not in the catalogue)
                </label>
              </div>
            </Row>
          ))}
        </Section>
      )}

      {groups.none.length > 0 && (
        <Section
          title="No match found"
          hint="Nothing close in the catalogue. Mark them to stop suggesting."
        >
          {groups.none.map((r) => (
            <Row key={r.itemId} row={r}>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none text-zinc-500">
                <Checkbox
                  checked={choices[r.itemId]?.kind === "skip"}
                  onChange={(e) =>
                    set(r.itemId, e.target.checked ? { kind: "skip" } : null)
                  }
                />
                Not in the catalogue
              </label>
            </Row>
          ))}
        </Section>
      )}

      {groups.setAside.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-500 hover:underline">
            {groups.setAside.length} not sealed products (graded slabs, promos)
            or already marked not in the catalogue
          </summary>
          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
            {groups.setAside.map((r) => (
              <li
                key={r.itemId}
                className="px-3 py-2 flex items-center justify-between gap-3"
              >
                <span className="truncate">{r.name}</span>
                {r.status === "skipped" && (
                  <button
                    type="button"
                    onClick={() => set(r.itemId, { kind: "unlink" })}
                    className="text-xs text-zinc-500 hover:underline shrink-0"
                  >
                    {choices[r.itemId]?.kind === "unlink"
                      ? "will suggest again"
                      : "Suggest again"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {autoLinked.length > 0 && (
        <LinkedList
          title={`${autoLinked.length} linked automatically`}
          hint="The daily sync linked these because each had one clear match with a similar price. Unlink any that are wrong; the sync won't link them again."
          rows={autoLinked}
          choices={choices}
          set={set}
          open
        />
      )}
      {manualLinked.length > 0 && (
        <LinkedList
          title={`${manualLinked.length} linked by you`}
          rows={manualLinked}
          choices={choices}
          set={set}
        />
      )}

      <Card className="p-4 flex flex-wrap items-center gap-3 sticky bottom-3 shadow-lg">
        <span className="text-sm text-zinc-600 dark:text-zinc-300">
          {pendingChoices.length === 0
            ? "Nothing selected yet."
            : `${pendingChoices.length} change${pendingChoices.length === 1 ? "" : "s"} ready to save.`}
        </span>
        <Button
          className="sm:ml-auto"
          disabled={pending || pendingChoices.length === 0}
          onClick={save}
        >
          {pending ? "Saving…" : "Save links"}
        </Button>
        {error && (
          <p
            role="alert"
            className="basis-full text-sm text-rose-600 dark:text-rose-400"
          >
            {error}
          </p>
        )}
      </Card>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="font-medium">{title}</h2>
      <p className="text-xs text-zinc-500 mb-2">{hint}</p>
      <Card className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {children}
      </Card>
    </section>
  );
}

function Row({ row, children }: { row: LinkRow; children: React.ReactNode }) {
  return (
    <div className="p-3 grid grid-cols-1 sm:grid-cols-5 gap-x-4 gap-y-2">
      <div className="sm:col-span-2 min-w-0">
        <div className="font-medium leading-snug">{row.name}</div>
        <div className="text-xs text-zinc-500">
          {row.held > 0 ? `${row.held} held` : "none held"}
          {row.itemUsdCents != null &&
            ` · your price ≈ ${usd(row.itemUsdCents)}`}
        </div>
      </div>
      <div className="sm:col-span-3 min-w-0">{children}</div>
    </div>
  );
}

function Candidate({
  o,
  itemUsdCents,
}: {
  o: LinkRow["options"][number];
  itemUsdCents: number | null;
}) {
  return (
    <span className="min-w-0">
      <span className="block leading-snug">{o.name}</span>
      <span className="block text-xs text-zinc-500">
        {o.setName} · {o.language === "ja" ? "Japanese" : "English"}
        {o.marketCents != null
          ? ` · TCGplayer ${usd(o.marketCents)}`
          : " · no price"}
      </span>
      {o.sanity === "differs" && itemUsdCents != null && (
        <span className="block text-xs text-amber-700 dark:text-amber-400">
          Price is very different from yours: check it&apos;s the same product
          (a box, not a case or display).
        </span>
      )}
    </span>
  );
}

function LinkedList({
  title,
  hint,
  rows,
  choices,
  set,
  open,
}: {
  title: string;
  hint?: string;
  rows: LinkRow[];
  choices: Record<string, Choice>;
  set: (itemId: string, c: Choice | null) => void;
  open?: boolean;
}) {
  return (
    <details className="text-sm" open={open}>
      <summary className="cursor-pointer font-medium hover:underline">
        {title}
      </summary>
      {hint && <p className="mt-1 text-xs text-zinc-500 max-w-prose">{hint}</p>}
      <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-800">
        {rows.map((r) => (
          <li
            key={r.itemId}
            className="px-3 py-2 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="truncate">{r.name}</div>
              <div className="text-xs text-zinc-500 truncate">
                {r.linked
                  ? `${r.linked.name} · ${r.linked.setName}${r.linked.marketCents != null ? ` · ${usd(r.linked.marketCents)}` : ""}`
                  : "linked product no longer in the catalogue"}
              </div>
            </div>
            <button
              type="button"
              onClick={() =>
                choices[r.itemId]?.kind === "unlink"
                  ? set(r.itemId, null)
                  : set(r.itemId, { kind: "unlink" })
              }
              className="text-xs text-zinc-500 hover:text-rose-600 shrink-0"
            >
              {choices[r.itemId]?.kind === "unlink"
                ? "will unlink · undo"
                : "Unlink"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
