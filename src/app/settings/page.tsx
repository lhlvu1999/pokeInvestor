export const dynamic = "force-dynamic";

import Link from "next/link";
import { Card } from "@/components/ui";
import {
  getCostMethod,
  getDisplayCurrency,
  getPriceChartingToken,
} from "@/lib/server/settings";
import { SettingsForm } from "./SettingsForm";
import { PriceChartingForm } from "./PriceChartingForm";
import { CostMethodForm } from "./CostMethodForm";
import { RestoreForm } from "./RestoreForm";
import { getLastBackupAt } from "@/lib/server/backup";
import { daysSinceBackup } from "@/lib/calc/backup";

export default async function SettingsPage() {
  const [current, token, costMethod, lastBackup] = await Promise.all([
    getDisplayCurrency(),
    getPriceChartingToken(),
    getCostMethod(),
    getLastBackupAt(),
  ]);
  const days = daysSinceBackup(lastBackup, new Date());
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="p-4">
        <Link href="/settings/checklist" className="flex items-center justify-between gap-3 text-sm">
          <span>
            <span className="font-medium">Setup checklist</span>
            <span className="block text-xs text-zinc-500">
              The few things only you can do, checked against your data.
            </span>
          </span>
          <span className="text-sky-700 dark:text-sky-400 text-xs font-medium">Open</span>
        </Link>
      </Card>
      <Card className="p-5">
        <h2 className="font-medium mb-4">Display currency</h2>
        <SettingsForm current={current} />
      </Card>
      <Card className="p-5">
        <h2 className="font-medium mb-1">Cost method</h2>
        <p className="text-xs text-zinc-500 mb-4">
          How a sale is matched to what you paid for the units that left.
        </p>
        <CostMethodForm current={costMethod} />
      </Card>
      <Card className="p-5" id="backup">
        <h2 className="font-medium mb-1">Backup and restore</h2>
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          Everything of yours lives in one database on this machine. A backup is a single file you
          can keep anywhere: your items and pictures, every buy and sell, recently deleted entries,
          price history, the watchlist and these settings. It leaves out what the app fetches again
          by itself (the catalogue, YouTube results) and your PriceCharting token.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/export/backup"
            className="inline-flex items-center justify-center rounded-md px-4 h-9 text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900"
          >
            Download backup
          </a>
          <span className="text-xs text-zinc-500">
            {lastBackup
              ? `Last backup ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`
              : "No backup yet"}
          </span>
        </div>
        <h3 className="mt-5 mb-1 text-sm font-medium">Restore from a backup</h3>
        <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
          Choose a file to see what it would change first; nothing happens until you confirm.
          Restoring only adds rows back or puts rows with the same id back to how the file has
          them. It never deletes anything. On a new install, run the catalogue sync first
          (<code>catalog-sync</code> in the pipeline) and then restore, so your links to the
          catalogue come back too; restoring again is safe.
        </p>
        <RestoreForm />
      </Card>
      <Card className="p-5">
        <h2 className="font-medium mb-1">PriceCharting integration</h2>
        <p className="text-xs text-zinc-500 mb-4">
          Add your{" "}
          <a
            href="https://www.pricecharting.com/api-documentation"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            PriceCharting API token
          </a>{" "}
          to enable per-item live price refresh. Token is stored locally in your
          database.
        </p>
        <PriceChartingForm hasToken={Boolean(token)} />
      </Card>
    </div>
  );
}
