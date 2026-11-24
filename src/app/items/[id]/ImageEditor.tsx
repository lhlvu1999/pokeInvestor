"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearItemImage,
  setItemImageLink,
  uploadItemImage,
} from "@/lib/server/item_image";

/** Longest side of a stored picture, in pixels. Plenty for a thumbnail. */
const MAX_SIDE = 480;

/** Shrink a chosen file to a JPEG data URL in the browser. */
async function shrink(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't resize pictures.");
  // A white backdrop, because JPEG has no transparency.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

const button =
  "inline-flex items-center justify-center rounded-md px-3 h-8 text-xs font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50";

export function ImageEditor({
  id,
  hasImage,
}: {
  id: string;
  hasImage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const file = useRef<HTMLInputElement>(null);

  function done() {
    setOpen(false);
    setLink("");
    setError(null);
    router.refresh();
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await uploadItemImage(id, await shrink(f));
        if (!res.ok) setError(res.error);
        else done();
      } catch {
        setError("That file couldn't be read as a picture.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:underline underline-offset-2"
      >
        {hasImage ? "Change picture" : "Add picture"}
      </button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2 max-w-sm text-xs">
      <div className="flex gap-2">
        <input
          type="url"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="Paste a link to a picture"
          aria-label="Link to a picture"
          disabled={pending}
          className="h-8 min-w-0 flex-1 px-2 rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs"
        />
        <button
          type="button"
          disabled={pending || link.trim() === ""}
          className={button}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const res = await setItemImageLink(id, link);
              if (!res.ok) setError(res.error);
              else done();
            })
          }
        >
          Use link
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className={button}
          disabled={pending}
          onClick={() => file.current?.click()}
        >
          {pending ? "Saving…" : "Upload a file"}
        </button>
        {hasImage && (
          <button
            type="button"
            className={`${button} text-rose-700 dark:text-rose-400`}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await clearItemImage(id);
                if (!res.ok) setError(res.error);
                else done();
              })
            }
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
          className="text-zinc-500 hover:underline"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-zinc-500 leading-relaxed">
        A file is shrunk on your device before it is saved. If the item is
        linked to a catalogue product, removing the picture lets the catalogue
        one come back.
      </p>
      {error && <p className="text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
