/**
 * The setup checklist: the things only you can do, worked out from your data so
 * the list is always current and says when it is finished. Pure, so the rules
 * can be tested without a database.
 */

export type ChecklistState = "todo" | "ok" | "info";

export type ChecklistItem = {
  key: string;
  state: ChecklistState;
  title: string;
  detail: string;
  /** Where to go to deal with it, or null when it is a setting outside the app. */
  href: string | null;
  cta: string | null;
};

export type ChecklistInput = {
  /** Days since the last backup; null = never. */
  backupDays: number | null;
  /** Sales logged for nothing and not marked as gifted/lost/opened. */
  freeSales: number;
  /** Held sealed items not linked to the catalogue (and not skipped). */
  unlinkedHeld: number;
  /** Held graded slabs with no matched card (and not marked wrong). */
  unmatchedSlabs: number;
  /** Held items with no picture. */
  noPicture: number;
  /** Items you hold. */
  heldItems: number;
  /** Hours since the newest market price; null = none at all. */
  priceAgeHours: number | null;
  config: {
    login: "off" | "on" | "broken";
    ebay: boolean;
    cron: "off" | "on" | "broken";
  };
};

export const BACKUP_FRESH_DAYS = 30;
export const PRICES_FRESH_HOURS = 48;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function buildChecklist(i: ChecklistInput): ChecklistItem[] {
  const out: ChecklistItem[] = [];

  out.push(
    i.backupDays !== null && i.backupDays < BACKUP_FRESH_DAYS
      ? {
          key: "backup",
          state: "ok",
          title: "Backed up",
          detail: `Last backup ${i.backupDays === 0 ? "today" : `${i.backupDays} ${plural(i.backupDays, "day", "days")} ago`}.`,
          href: "/settings#backup",
          cta: "Back up again",
        }
      : {
          key: "backup",
          state: "todo",
          title: i.backupDays === null ? "Download your first backup" : "Refresh your backup",
          detail:
            i.backupDays === null
              ? "Everything lives in one database on this machine; a file kept elsewhere is the only safety net."
              : `The last backup was ${i.backupDays} days ago.`,
          href: "/settings#backup",
          cta: "Back up",
        },
  );

  out.push(
    i.freeSales === 0
      ? { key: "free-sales", state: "ok", title: "No unexplained ₫0 sales", detail: "Every sale for nothing says why it left.", href: null, cta: null }
      : {
          key: "free-sales",
          state: "todo",
          title: `Say why ${i.freeSales} ${plural(i.freeSales, "sale", "sales")} for nothing left`,
          detail: "Marked as gifted, lost or opened they stop counting as losing sales, which fixes your win rate and margin. Profit is the same either way.",
          href: "/analytics/annual#check",
          cta: "Review",
        },
  );

  out.push(
    i.unlinkedHeld === 0
      ? { key: "link", state: "ok", title: "Held products are linked to the catalogue", detail: "Linked items get set insights, price context and set tags.", href: "/catalog/links", cta: "Open" }
      : {
          key: "link",
          state: "todo",
          title: `Link ${i.unlinkedHeld} held ${plural(i.unlinkedHeld, "product", "products")} to the catalogue`,
          detail: "The automatic match wasn't sure about these. Choosing the right product also fills the picture and the set tag.",
          href: "/catalog/links",
          cta: "Link",
        },
  );

  out.push(
    i.unmatchedSlabs === 0
      ? { key: "slabs", state: "ok", title: "Slabs are matched to their cards", detail: "Each has a raw-card price to compare with.", href: "/analytics/slabs", cta: "Open" }
      : {
          key: "slabs",
          state: "todo",
          title: `Pick the card for ${i.unmatchedSlabs} ${plural(i.unmatchedSlabs, "slab", "slabs")}`,
          detail: "No single card fit automatically. \"Choose card\" on the Slabs page takes a few seconds each.",
          href: "/analytics/slabs",
          cta: "Choose",
        },
  );

  out.push(
    i.noPicture === 0
      ? { key: "pictures", state: "ok", title: "Everything you hold has a picture", detail: "", href: null, cta: null }
      : {
          key: "pictures",
          state: "todo",
          title: `Add a picture to ${i.noPicture} ${plural(i.noPicture, "item", "items")}`,
          detail: "Optional. Use \"Add picture\" on an item's page (paste a link or upload a file).",
          href: "/items",
          cta: "Items",
        },
  );

  const fresh = i.priceAgeHours !== null && i.priceAgeHours < PRICES_FRESH_HOURS;
  out.push(
    fresh
      ? { key: "prices", state: "ok", title: "Prices are fresh", detail: `Newest price is ${Math.max(1, Math.round(i.priceAgeHours as number))}h old.`, href: null, cta: null }
      : {
          key: "prices",
          state: "todo",
          title: i.priceAgeHours === null ? "Fetch market prices" : "Refresh market prices",
          detail:
            i.priceAgeHours === null
              ? "Nothing is priced yet, so stock value and alerts have nothing to go on."
              : `The newest price is ${Math.round(i.priceAgeHours / 24)} days old. Use Update all prices, or schedule it (below).`,
          href: "/items",
          cta: "Update prices",
        },
  );

  out.push(
    i.config.ebay
      ? { key: "ebay", state: "ok", title: "eBay keys are set", detail: "Price estimates can run.", href: null, cta: null }
      : {
          key: "ebay",
          state: "todo",
          title: "Add your eBay keys",
          detail: "Set EBAY_APP_ID and EBAY_CERT_ID in .env to switch on price estimates (see .env.example), then restart.",
          href: null,
          cta: null,
        },
  );

  out.push(
    i.config.cron === "on"
      ? { key: "cron", state: "ok", title: "Scheduled price refresh is enabled", detail: "The pipeline's refresh-prices command can call this app.", href: null, cta: null }
      : i.config.cron === "broken"
        ? { key: "cron", state: "todo", title: "Fix CRON_TOKEN", detail: "It is set but too short (32 characters needed), so the scheduled refresh is refused. Try: openssl rand -hex 32.", href: null, cta: null }
        : { key: "cron", state: "info", title: "Scheduled price refresh is off", detail: "Optional. Set CRON_TOKEN (and APP_URL for the pipeline) to refresh prices daily so alerts use fresh numbers.", href: null, cta: null },
  );

  out.push(
    i.config.login === "on"
      ? { key: "login", state: "ok", title: "Login is on", detail: "Every page and action needs a sign-in.", href: null, cta: null }
      : i.config.login === "broken"
        ? { key: "login", state: "todo", title: "Fix APP_PASSWORD", detail: "It is set but too short (8 characters needed), so the app is locked until it is fixed.", href: null, cta: null }
        : { key: "login", state: "info", title: "No login", detail: "Fine on your own computer. If anyone else can reach this app, set APP_PASSWORD (and use https).", href: null, cta: null },
  );

  out.push({
    key: "alerts",
    state: "info",
    title: "Alerts need a webhook in the pipeline",
    detail: "ALERT_WEBHOOK_URL is set where the pipeline runs, not here, so this page can't check it. Without it the buy, sell and usual-low alerts and the weekly summary send nothing.",
    href: null,
    cta: null,
  });

  // To do first, then done, then the notes.
  const order: Record<ChecklistState, number> = { todo: 0, ok: 1, info: 2 };
  return out
    .map((item, idx) => ({ item, idx }))
    .sort((a, b) => order[a.item.state] - order[b.item.state] || a.idx - b.idx)
    .map((x) => x.item);
}

/** "5 of 8 done": the notes ("info") are not counted. */
export function progress(items: readonly ChecklistItem[]): { done: number; total: number } {
  const counted = items.filter((x) => x.state !== "info");
  return { done: counted.filter((x) => x.state === "ok").length, total: counted.length };
}
