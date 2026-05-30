"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  bulkSetBuyStatus,
  type StatusCounts,
} from "@/lib/server/admin";

export function BulkStatusSection({ counts }: { counts: StatusCounts }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function run(status: "received" | "pending") {
    const label = status === "received" ? "received" : "pending (on the way)";
    const target = status === "received" ? counts.pendingBuys : counts.receivedBuys;
    if (target === 0) {
      setErr(`No buys to flip to ${label}.`);
      return;
    }
    if (
      !confirm(
        `Mark ${target} buy transaction(s) as ${label}? This affects every buy currently in the opposite state.`,
      )
    ) {
      return;
    }
    setErr(null);
    setMsg(null);
    startTransition(async () => {
      const res = await bulkSetBuyStatus(status);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setMsg(`Updated ${res.data.updated} transaction(s).`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-zinc-600 dark:text-zinc-300 grid grid-cols-3 gap-2">
        <Stat label="Received buys" value={counts.receivedBuys} />
        <Stat label="Pending buys" value={counts.pendingBuys} />
        <Stat label="Sells" value={counts.sells} />
      </div>
      <div className="flex gap-2 flex-wrap">
        <Button
          variant="secondary"
          onClick={() => run("received")}
          disabled={pending}
        >
          Mark all buys as received
        </Button>
        <Button
          variant="secondary"
          onClick={() => run("pending")}
          disabled={pending}
        >
          Mark all buys as pending
        </Button>
      </div>
      {msg && (
        <div className="text-sm text-emerald-600 dark:text-emerald-400">{msg}</div>
      )}
      {err && (
        <div className="text-sm text-rose-600 dark:text-rose-400">{err}</div>
      )}
      <p className="text-xs text-zinc-500">
        Sells are always treated as received and aren&apos;t affected.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
