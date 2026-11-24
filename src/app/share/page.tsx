export const dynamic = "force-dynamic";

import { getShareLines } from "@/lib/server/share";
import { getDisplayCurrency } from "@/lib/server/settings";
import { ShareBuilder } from "./ShareBuilder";

/**
 * Share a snapshot of your collection. Cost basis and profit are off unless
 * you tick them, and the preview is exactly what the other person gets.
 */
export default async function SharePage() {
  const currency = await getDisplayCurrency();
  const { lines, tags, skipped } = await getShareLines(currency);
  const now = new Date();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Share</h1>
        <p className="text-xs text-zinc-500 mt-0.5 max-w-prose">
          Send someone a read-only snapshot of what you hold. Choose what goes
          in; what you paid and your profit stay out unless you add them.
        </p>
      </div>
      <ShareBuilder
        lines={lines}
        tags={tags}
        currency={currency}
        skipped={skipped}
        now={now.getTime()}
      />
    </div>
  );
}
