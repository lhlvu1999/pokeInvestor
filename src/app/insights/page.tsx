export const dynamic = "force-dynamic";

import { EmptyState } from "@/components/ui";
import { listInsights } from "@/lib/server/insights";
import { InsightCard } from "./InsightCard";

export default async function InsightsPage() {
  const insights = await listInsights(50);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-xs text-zinc-500 mt-1">
          LLM-extracted opinions from the videos in your source list. The
          newest extractions are at the top.
        </p>
      </div>

      {insights.length === 0 ? (
        <EmptyState
          title="No insights yet"
          description="Add sources and run the Python pipeline to populate this view."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      )}
    </div>
  );
}
