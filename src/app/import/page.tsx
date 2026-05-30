import { ImportForm } from "./ImportForm";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";

export default function ImportPage() {
  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Import from CSV</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-prose">
          Expected columns: <code>Item, In stock, Date IN, IN, Date Out, OUT, % profit, Profit</code>.
          Each row becomes a buy and (if Date Out + OUT &gt; 0) a matched sell.
          Quantity is parsed from the item name suffix (e.g. <code>x 60</code>).
          Items are deduplicated case-insensitively against your existing list.
        </p>
      </div>
      <ImportForm defaultCurrency={DEFAULT_TRANSACTION_CURRENCY} />
    </div>
  );
}
