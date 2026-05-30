export const dynamic = "force-dynamic";

import { ButtonLink, Card } from "@/components/ui";
import {
  getDataSummary,
  getStatusCounts,
  previewAutoTag,
} from "@/lib/server/admin";
import { BulkStatusSection } from "./BulkStatusSection";
import { AutoTagSection } from "./AutoTagSection";
import { WipeSection } from "./WipeSection";
import { SyncSchemaSection } from "./SyncSchemaSection";

type SectionData = {
  ok: true;
  statusCounts: Awaited<ReturnType<typeof getStatusCounts>>;
  autoTagPreview: Awaited<ReturnType<typeof previewAutoTag>>;
  dataSummary: Awaited<ReturnType<typeof getDataSummary>>;
};

type SectionError = { ok: false; message: string };

/**
 * Wraps the data loads — if the DB schema is out of date relative to the
 * code (e.g. missing columns), the queries throw. We catch and show a
 * notice pointing to the Sync schema section instead of 500'ing.
 */
async function safeLoad(): Promise<SectionData | SectionError> {
  try {
    const [statusCounts, autoTagPreview, dataSummary] = await Promise.all([
      getStatusCounts(),
      previewAutoTag(),
      getDataSummary(),
    ]);
    return { ok: true, statusCounts, autoTagPreview, dataSummary };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export default async function AdminPage() {
  const loaded = await safeLoad();

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Bulk actions across all data. Most are destructive — read the
          confirmation copy before clicking.
        </p>
      </div>

      <Card className="p-5">
        <h2 className="font-medium mb-3">Schema sync</h2>
        <SyncSchemaSection />
      </Card>

      <Card className="p-5">
        <h2 className="font-medium mb-3">YouTube insight prompts</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-3">
          Edit the LLM prompt the Python pipeline uses to extract insights
          from transcripts. Saving creates a new version and switches the
          pipeline to it on its next run.
        </p>
        <ButtonLink href="/admin/prompts" variant="secondary">
          Manage prompts
        </ButtonLink>
      </Card>

      <Card className="p-5">
        <h2 className="font-medium mb-3">Unmatched mentions</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-300 mb-3">
          Card / product mentions the matcher couldn&apos;t link to an
          existing item. Resolve them to surface insights against the right
          item on its detail page.
        </p>
        <ButtonLink href="/admin/mentions" variant="secondary">
          Review unmatched
        </ButtonLink>
      </Card>

      {!loaded.ok ? (
        <Card className="p-5 border-amber-300 dark:border-amber-800 bg-amber-50/30 dark:bg-amber-950/20">
          <h2 className="font-medium mb-2 text-amber-700 dark:text-amber-300">
            Other sections unavailable
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-300">
            The database schema is out of date — the rest of the admin page
            couldn&apos;t load. Click <strong>Sync schema</strong> above to
            apply pending changes, then reload this page.
          </p>
          <details className="mt-3 text-xs text-zinc-500">
            <summary className="cursor-pointer hover:underline">
              Show underlying error
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[11px]">
              {loaded.message}
            </pre>
          </details>
        </Card>
      ) : (
        <>
          <Card className="p-5">
            <h2 className="font-medium mb-3">Transaction status</h2>
            <BulkStatusSection counts={loaded.statusCounts} />
          </Card>

          <Card className="p-5">
            <h2 className="font-medium mb-3">Bulk auto-tag items</h2>
            <AutoTagSection initialPreview={loaded.autoTagPreview} />
          </Card>

          <Card className="p-5 border-rose-300 dark:border-rose-900">
            <h2 className="font-medium mb-3 text-rose-700 dark:text-rose-300">
              Danger zone — wipe all data
            </h2>
            <WipeSection summary={loaded.dataSummary} />
          </Card>
        </>
      )}
    </div>
  );
}
