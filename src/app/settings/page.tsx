export const dynamic = "force-dynamic";

import { Card } from "@/components/ui";
import {
  getDisplayCurrency,
  getPriceChartingToken,
} from "@/lib/server/settings";
import { SettingsForm } from "./SettingsForm";
import { PriceChartingForm } from "./PriceChartingForm";

export default async function SettingsPage() {
  const [current, token] = await Promise.all([
    getDisplayCurrency(),
    getPriceChartingToken(),
  ]);
  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Card className="p-5">
        <h2 className="font-medium mb-4">Display currency</h2>
        <SettingsForm current={current} />
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
          to enable per-item live price refresh. Token is stored locally in
          your database.
        </p>
        <PriceChartingForm hasToken={Boolean(token)} />
      </Card>
    </div>
  );
}
