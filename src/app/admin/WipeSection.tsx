"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, TextInput } from "@/components/ui";
import { wipeAllData, type WipeSummary } from "@/lib/server/admin";

export function WipeSection({ summary }: { summary: WipeSummary }) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await wipeAllData(confirmation);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(
        `Wiped ${res.data.items} item(s), ${res.data.transactions} transaction(s), ${res.data.marketPrices} price(s), ${res.data.fxRates} FX rate(s), ${res.data.settings} setting(s).`,
      );
      setConfirmation("");
      router.refresh();
    });
  }

  const hasData =
    summary.items + summary.transactions + summary.marketPrices > 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-300">
        Deletes every item, transaction, market price, FX rate, and app
        setting. The schema (table structure) is unchanged — you do not need
        to run <code>db:reset</code>. After wipe, you can re-import or start
        fresh.
      </p>
      <div className="text-sm grid grid-cols-2 sm:grid-cols-5 gap-2">
        <Stat label="Items" value={summary.items} />
        <Stat label="Transactions" value={summary.transactions} />
        <Stat label="Prices" value={summary.marketPrices} />
        <Stat label="FX cache" value={summary.fxRates} />
        <Stat label="Settings" value={summary.settings} />
      </div>
      {hasData ? (
        <>
          <p className="text-sm">
            Type <strong>DELETE EVERYTHING</strong> below to enable the button:
          </p>
          <TextInput
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="DELETE EVERYTHING"
            className="font-mono"
          />
          <div>
            <Button
              variant="danger"
              onClick={run}
              disabled={pending || confirmation !== "DELETE EVERYTHING"}
            >
              {pending ? "Wiping..." : "Wipe all data"}
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Nothing to wipe — database is already empty.</p>
      )}
      {msg && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>
      )}
      {err && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{err}</div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
