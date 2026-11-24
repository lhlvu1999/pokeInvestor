import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { validateBackup } from "@/lib/calc/backup";
import { applyBackup, previewBackup } from "@/lib/server/backup";
import { refuseCrossSite } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Typed by the person to apply a restore; anything else only previews. */
const CONFIRM_WORD = "RESTORE";
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * POST /api/backup/restore  (multipart: `file`, optional `confirm`)
 *
 * Without `confirm=RESTORE` it only reports what would happen. With it, the
 * rows are added back or overwritten (never deleted), all or nothing.
 */
export async function POST(req: Request) {
  const refused = refuseCrossSite(req);
  if (refused) return refused;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the backup file." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose a backup file." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "That file is too large." }, { status: 413 });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return NextResponse.json({ error: "That file isn't a backup (it isn't valid JSON)." }, { status: 400 });
  }
  const checked = validateBackup(parsed);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const confirmed = form.get("confirm") === CONFIRM_WORD;
  try {
    const tables = confirmed
      ? await applyBackup(checked.backup)
      : await previewBackup(checked.backup);
    if (confirmed) revalidatePath("/", "layout");
    return NextResponse.json({
      applied: confirmed,
      createdAt: checked.backup.createdAt,
      tables,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          (confirmed ? "Nothing was changed. " : "") +
          (err instanceof Error ? err.message : "The backup could not be read."),
      },
      { status: 422 },
    );
  }
}
