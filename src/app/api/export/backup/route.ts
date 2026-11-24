import { backupFileName } from "@/lib/calc/backup";
import { exportBackup } from "@/lib/server/backup";

export const dynamic = "force-dynamic";

/** Everything of yours, as one JSON file (see calc/backup.ts for what is in it). */
export async function GET() {
  const now = new Date();
  const backup = await exportBackup(now);
  return new Response(JSON.stringify(backup), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${backupFileName(now)}"`,
      "Cache-Control": "no-store",
    },
  });
}
