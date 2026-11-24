"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { allowRawCardMatch, rejectRawCard } from "@/lib/server/slab_actions";

/** "Wrong card?" on a matched slab, or "Match again" on one you rejected. */
export function RejectButton({
  id,
  mode,
}: {
  id: string;
  mode: "reject" | "allow";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await (mode === "reject" ? rejectRawCard(id) : allowRawCardMatch(id));
            if (!res.ok) setError(res.error);
            else router.refresh();
          })
        }
        className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-2 disabled:opacity-50"
      >
        {mode === "reject" ? "Wrong card?" : "Match again"}
      </button>
      {error && <span className="ml-2 text-[11px] text-rose-600">{error}</span>}
    </span>
  );
}
