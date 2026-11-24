export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import { getTagPlan } from "@/lib/server/set_tags";
import { MergeForm } from "./MergeForm";

/**
 * Your own tags for sets ("mega2.5", "pris") and the catalogue's set for the same
 * items are two names for one thing. This page offers to merge them: your tag is
 * renamed to the set's real name.
 */
export default async function TagsPage() {
  const plan = await getTagPlan();
  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <div>
        <Link href="/items" className="text-sm text-zinc-500 hover:underline">
          ← Items
        </Link>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Tags and sets</h1>
        <p className="text-xs text-zinc-500 mt-1 max-w-prose leading-relaxed">
          Items linked to the catalogue know their real set. A tag of yours is offered for renaming to that
          set&apos;s name only when every linked item carrying it is in the same set; a tag spread over
          several sets (like <code>etb</code> or <code>slab</code>) is a kind of product and is left alone.
          Items you haven&apos;t linked yet can&apos;t be checked, so link them first for the best result.
        </p>
      </div>

      <Card className="p-4">
        <h2 className="font-medium text-sm mb-2">Tags that name a set</h2>
        <MergeForm proposals={plan.proposals} addable={plan.missingSetTag} />
      </Card>

      {plan.kept.length > 0 && (
        <Card className="p-4">
          <h2 className="font-medium text-sm">Kept as they are</h2>
          <p className="text-[11px] text-zinc-500 mt-1">
            These span several sets, or none of their items is linked to the catalogue yet.
          </p>
          <p className="mt-2 text-sm flex flex-wrap gap-x-4 gap-y-1">
            {plan.kept.map((k) => (
              <span key={k.tag}>
                {k.tag} <span className="text-zinc-500">{k.count}</span>
              </span>
            ))}
          </p>
        </Card>
      )}
    </div>
  );
}
