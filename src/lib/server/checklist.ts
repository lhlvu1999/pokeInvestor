import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { readAuthConfig } from "@/lib/calc/auth";
import { daysSinceBackup } from "@/lib/calc/backup";
import { isSealedCandidate } from "@/lib/calc/catalog_match";
import { buildChecklist, type ChecklistItem } from "@/lib/calc/checklist";
import { readCronConfig } from "@/lib/calc/cron_auth";
import { isSlabName } from "@/lib/calc/slab";
import { getLastBackupAt } from "./backup";
import { getDataIssues } from "./data_checks";

type Held = {
  name: string;
  tags: string[] | null;
  image_url: string;
  catalog_product_id: string | number | null;
  catalog_link_skipped: boolean;
  catalog_link_source: string | null;
  raw_card_product_id: string | number | null;
  raw_card_skipped: boolean;
};

/** Everything on the setup checklist, worked out from the database and the settings. Read-only. */
export async function getChecklist(now = new Date()): Promise<ChecklistItem[]> {
  const [heldRows, priceRow, lastBackup, issues] = await Promise.all([
    db.execute<Held>(sql`
      SELECT i.name, i.tags, COALESCE(i.image_url, '') AS image_url, i.catalog_product_id,
             i.catalog_link_skipped, i.catalog_link_source, i.raw_card_product_id, i.raw_card_skipped
        FROM items i
       WHERE COALESCE((SELECT sum(CASE WHEN t.type = 'buy' AND t.status = 'received' THEN t.quantity
                                       WHEN t.type = 'sell' THEN -t.quantity ELSE 0 END)
                         FROM transactions t WHERE t.item_id = i.id), 0) > 0`),
    db.execute<{ last: Date | null }>(sql`SELECT max(fetched_at) AS last FROM market_prices`),
    getLastBackupAt(),
    getDataIssues(now),
  ]);
  const held = Array.from(heldRows);
  const lastPrice = Array.from(priceRow)[0]?.last ?? null;

  let unlinkedHeld = 0;
  let unmatchedSlabs = 0;
  for (const h of held) {
    const tags = h.tags ?? [];
    if (isSlabName(h.name, tags)) {
      if (h.raw_card_product_id == null && !h.raw_card_skipped) unmatchedSlabs += 1;
    } else if (
      isSealedCandidate({ name: h.name, tags }) &&
      h.catalog_product_id == null &&
      !h.catalog_link_skipped &&
      h.catalog_link_source == null
    ) {
      unlinkedHeld += 1;
    }
  }

  return buildChecklist({
    backupDays: daysSinceBackup(lastBackup, now),
    freeSales: issues.filter((f) => f.kind === "free_sale").length,
    unlinkedHeld,
    unmatchedSlabs,
    noPicture: held.filter((h) => h.image_url === "").length,
    heldItems: held.length,
    priceAgeHours: lastPrice ? (now.getTime() - new Date(lastPrice).getTime()) / 3_600_000 : null,
    config: {
      login: readAuthConfig(process.env).mode,
      ebay: Boolean(process.env.EBAY_APP_ID && process.env.EBAY_CERT_ID),
      cron: readCronConfig(process.env).mode,
    },
  });
}
