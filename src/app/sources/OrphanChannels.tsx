"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import { adoptChannelAsSource } from "@/lib/server/youtube";
import type { OrphanChannel } from "@/lib/server/youtube_stats";

function when(iso: string | null): string {
  if (!iso) return "no dates";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Channels whose videos are on file but which are not sources. Insights
 * still reads that history, so it looks current while nothing new is being
 * fetched. One click per channel makes it a source again.
 */
export function OrphanChannels({
  channels,
}: {
  channels: (Omit<OrphanChannel, "latestPublishedAt"> & {
    latestPublishedAt: string | null;
  })[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (channels.length === 0) return null;
  const videos = channels.reduce((n, c) => n + c.videoCount, 0);

  function adopt(channelId: string) {
    setError(null);
    setBusy(channelId);
    startTransition(async () => {
      const res = await adoptChannelAsSource(channelId);
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card className="p-5 border-amber-300 dark:border-amber-800">
      <h2 className="font-medium">
        {channels.length} channel{channels.length === 1 ? "" : "s"} with videos
        on file but no source
      </h2>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
        {`${videos} videos from these channels are kept and still feed Insights, but because they aren’t sources, no new videos are being fetched. Add a channel back to resume. Its existing videos are linked to it and are not downloaded again.`}
      </p>
      <ul className="mt-3 divide-y divide-zinc-200 dark:divide-zinc-800">
        {channels.map((c) => (
          <li
            key={c.channelId}
            className="py-2.5 flex items-center justify-between gap-3"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">
                {c.title ?? c.channelId}
              </div>
              <div className="text-xs text-zinc-500">
                {c.videoCount} video{c.videoCount === 1 ? "" : "s"} · latest{" "}
                {when(c.latestPublishedAt)}
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => adopt(c.channelId)}
              className="shrink-0"
            >
              {busy === c.channelId ? "Adding…" : "Add as source"}
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p
          role="alert"
          className="mt-3 text-sm text-rose-600 dark:text-rose-400"
        >
          {error}
        </p>
      )}
    </Card>
  );
}
