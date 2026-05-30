export const dynamic = "force-dynamic";

import { ButtonLink, EmptyState } from "@/components/ui";
import { getDashboardData } from "@/lib/server/portfolio";
import { getDisplayCurrency } from "@/lib/server/settings";
import { ItemsTable } from "./ItemsTable";

export default async function ItemsPage() {
  const displayCurrency = await getDisplayCurrency();
  const { items, converted } = await getDashboardData(displayCurrency);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Items</h1>
        <div className="flex gap-2">
          <a
            href="/api/export/transactions"
            className="inline-flex items-center justify-center gap-2 rounded-md px-4 h-10 text-sm font-medium border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Export CSV
          </a>
          <ButtonLink href="/items/new">New item</ButtonLink>
        </div>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="No items yet"
          description="Add an item before logging transactions."
          action={<ButtonLink href="/items/new">New item</ButtonLink>}
        />
      ) : (
        <ItemsTable
          items={items}
          converted={converted}
          displayCurrency={displayCurrency}
        />
      )}
    </div>
  );
}
