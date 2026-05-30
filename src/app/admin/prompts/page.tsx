export const dynamic = "force-dynamic";

import { Card, EmptyState } from "@/components/ui";
import { YOUTUBE_INSIGHT_PROMPT_NAME } from "@/lib/youtube-constants";
import {
  ensureDefaultPrompts,
  getActivePrompt,
  listPrompts,
} from "@/lib/server/prompts";
import { PromptEditor } from "./PromptEditor";
import { PromptHistory } from "./PromptHistory";

export default async function PromptsPage() {
  await ensureDefaultPrompts();

  const active = await getActivePrompt(YOUTUBE_INSIGHT_PROMPT_NAME);
  const history = await listPrompts(YOUTUBE_INSIGHT_PROMPT_NAME);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Prompts</h1>
        <p className="text-xs text-zinc-500 mt-1">
          LLM prompts used by the Python pipeline. Saving creates a new
          version and switches the pipeline to it — old versions stay forever
          so every past insight can be traced to the exact wording that
          produced it. The model and temperature are set per environment via
          the pipeline&apos;s <code className="text-[11px]">LLM_MODEL</code> and{" "}
          <code className="text-[11px]">LLM_TEMPERATURE</code> env vars, not
          here.
        </p>
      </div>

      {active ? (
        <>
          <Card className="p-5">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-medium">
                {active.name}{" "}
                <span className="text-xs text-zinc-500 font-normal">
                  · active version {active.version}
                </span>
              </h2>
            </div>
            <PromptEditor prompt={active} />
          </Card>

          <Card className="p-0 overflow-hidden">
            <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800">
              <h2 className="font-medium">Version history</h2>
            </div>
            <PromptHistory versions={history} />
          </Card>
        </>
      ) : (
        <EmptyState
          title="Prompt missing"
          description="The default prompt couldn't be seeded. Check server logs."
        />
      )}
    </div>
  );
}
