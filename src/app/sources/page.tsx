export const dynamic = "force-dynamic";

import { Card, EmptyState } from "@/components/ui";
import { listYoutubeSources } from "@/lib/server/youtube";
import { AddSourceForm } from "./AddSourceForm";
import { SourcesTable } from "./SourcesTable";

export default async function SourcesPage() {
  const sources = await listYoutubeSources();

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">YouTube sources</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Channels and individual videos the insight pipeline will crawl.
          Marking a source inactive keeps its history but stops new fetches.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="font-medium mb-3">Add source</h2>
        <AddSourceForm />
      </Card>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Paste a YouTube channel URL, @handle, or video URL above to get started."
        />
      ) : (
        <Card className="p-0 overflow-hidden">
          <SourcesTable sources={sources} />
        </Card>
      )}
    </div>
  );
}
