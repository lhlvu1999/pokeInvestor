import { ImportForm } from "./ImportForm";
import { DEFAULT_TRANSACTION_CURRENCY } from "@/lib/currency";
import { COLUMN_SPECS } from "@/lib/import";
import { getVisionStatus } from "@/lib/server/vision";
import { ScreenshotImport } from "./ScreenshotImport";

/**
 * Import a spreadsheet of purchases and sales. The column guide is generated
 * from the same spec the importer reads, so the page can't drift from what
 * the importer actually accepts.
 */
export default async function ImportPage() {
  const vision = await getVisionStatus();
  const shown = COLUMN_SPECS.filter((c) => c.field !== "inStock");
  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Import from a spreadsheet</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-prose">
          Bring in past purchases and sales from a file or by pasting cells.
          Each row is one purchase and, if it has a sale, the matching sale. You
          see everything before anything is saved.
        </p>
      </div>

      <section aria-labelledby="columns-heading">
        <h2 id="columns-heading" className="text-sm font-medium mb-2">
          What the columns mean
        </h2>
        <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {shown.map((c) => (
                <tr key={c.field} className="align-top">
                  <td className="px-3 py-2 whitespace-nowrap">
                    <code className="font-medium">{c.label}</code>
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {c.required ? (
                      <span className="text-rose-600 dark:text-rose-400">
                        needed
                      </span>
                    ) : (
                      <span className="text-zinc-500">optional</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-zinc-600 dark:text-zinc-300">
                    {c.help}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-zinc-500 max-w-prose leading-relaxed">
          Column names don&apos;t have to match exactly: &ldquo;Product&rdquo;,
          &ldquo;Buy date&rdquo;, &ldquo;Cost&rdquo;, &ldquo;Sold for&rdquo; and
          similar work too, and any other columns are ignored. Items are matched
          to your existing ones ignoring capital letters. If the same product
          already exists, the new rows are added to it.
        </p>
      </section>

      <ImportForm defaultCurrency={DEFAULT_TRANSACTION_CURRENCY} />

      <ScreenshotImport
        status={vision}
        defaultCurrency={DEFAULT_TRANSACTION_CURRENCY}
      />
    </div>
  );
}
