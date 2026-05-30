export const dynamic = "force-dynamic";

import { Card, EmptyState } from "@/components/ui";
import { listUnmatchedMentions } from "@/lib/server/insights";
import { UnmatchedMentions } from "./UnmatchedMentions";

export default async function MentionsAdminPage() {
  const groups = await listUnmatchedMentions(50);

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Unmatched mentions</h1>
        <p className="text-xs text-zinc-500 mt-1">
          LLM-extracted card / product mentions the fuzzy matcher couldn&apos;t
          confidently link to an existing item. Resolving one rawName updates
          every mention with that exact wording.
        </p>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Nothing to resolve"
          description="Every mention is either matched to an item or there are no mentions yet."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <UnmatchedMentions groups={groups} />
        </Card>
      )}
    </div>
  );
}
