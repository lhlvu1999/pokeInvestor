"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setStageAlert } from "@/lib/server/watchlist";
import { useToast } from "@/components/Toast";

/** Turn the "tell me at the usual low point" alert on or off for one entry. */
export function StageAlertToggle({
  entryId,
  on,
  disabled,
}: {
  entryId: string;
  on: boolean;
  /** True when nothing could fire (no usual low, or not in the catalogue). */
  disabled?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-[11px] text-zinc-500">
      <input
        type="checkbox"
        checked={on}
        disabled={pending || (disabled && !on)}
        onChange={(e) =>
          start(async () => {
            const res = await setStageAlert(entryId, e.target.checked);
            if (!res.ok) {
              toast.show({ kind: "error", message: res.error });
              return;
            }
            router.refresh();
          })
        }
        className="h-3.5 w-3.5"
      />
      Tell me when it reaches its usual low
    </label>
  );
}
