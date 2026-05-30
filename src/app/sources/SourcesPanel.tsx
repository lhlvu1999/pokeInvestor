"use client";

import { useState } from "react";
import { Button, Card } from "@/components/ui";
import type { YoutubeSource } from "@/db/schema";
import { AddSourceForm } from "./AddSourceForm";
import { SourceCard } from "./SourceCard";

/**
 * Stitches the add form + the source list into one client component so we
 * can share the collapse state. When there are existing sources, the form
 * is hidden behind a "+ Add source" button to give the list room to breathe;
 * when there are none, it stays open so the page has a single obvious CTA.
 */
export function SourcesPanel({ sources }: { sources: YoutubeSource[] }) {
  const [open, setOpen] = useState(sources.length === 0);

  return (
    <div className="flex flex-col gap-6">
      {sources.length > 0 && !open && (
        <Button onClick={() => setOpen(true)} className="self-start">
          + Add source
        </Button>
      )}

      {open && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium">Add source</h2>
            {sources.length > 0 && (
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
            )}
          </div>
          <AddSourceForm onAdded={() => setOpen(false)} />
        </Card>
      )}

      {sources.length > 0 && (
        <div className="flex flex-col gap-3">
          {sources.map((s) => (
            <SourceCard key={s.id} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}
