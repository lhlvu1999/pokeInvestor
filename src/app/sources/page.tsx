export const dynamic = "force-dynamic";

import { EmptyState } from "@/components/ui";
import { listYoutubeSources } from "@/lib/server/youtube";
import { SourcesPanel } from "./SourcesPanel";

export default async function SourcesPage() {
  const sources = await listYoutubeSources();
  const activeCount = sources.filter((s) => s.active).length;
  const pausedCount = sources.length - activeCount;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">YouTube sources</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Channels and individual videos the insight pipeline will crawl.
            Pausing keeps history but stops new fetches.
          </p>
        </div>
        {sources.length > 0 && (
          <div className="text-xs text-zinc-500 whitespace-nowrap">
            {activeCount} active{pausedCount > 0 ? ` · ${pausedCount} paused` : ""}
          </div>
        )}
      </div>

      {sources.length === 0 ? (
        // First-time users: form is the only thing on the page, no need to
        // collapse it. The EmptyState gives a single clear next step.
        <EmptyState
          title="No sources yet"
          description="Add a YouTube channel below to start crawling."
        />
      ) : null}

      <SourcesPanel sources={sources} />
    </div>
  );
}
