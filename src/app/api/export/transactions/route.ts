import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { items, transactions } from "@/db/schema";
import { minorToDecimalString } from "@/lib/currency";

export const dynamic = "force-dynamic";

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET() {
  const rows = await db
    .select({
      id: transactions.id,
      itemName: items.name,
      setCode: items.setCode,
      cardNumber: items.cardNumber,
      type: transactions.type,
      quantity: transactions.quantity,
      finalValueCents: transactions.finalValueCents,
      currency: transactions.currency,
      occurredAt: transactions.occurredAt,
      note: transactions.note,
    })
    .from(transactions)
    .innerJoin(items, eq(transactions.itemId, items.id))
    .orderBy(asc(transactions.occurredAt));

  const header = [
    "id",
    "item_name",
    "set_code",
    "card_number",
    "type",
    "quantity",
    "final_value",
    "currency",
    "occurred_at",
    "note",
  ].join(",");

  const lines = rows.map((r) =>
    [
      csvEscape(r.id),
      csvEscape(r.itemName),
      csvEscape(r.setCode),
      csvEscape(r.cardNumber),
      csvEscape(r.type),
      csvEscape(r.quantity),
      csvEscape(minorToDecimalString(r.finalValueCents, r.currency)),
      csvEscape(r.currency),
      csvEscape(r.occurredAt.toISOString()),
      csvEscape(r.note),
    ].join(","),
  );

  const body = [header, ...lines].join("\n") + "\n";

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="poke-investor-transactions-${new Date()
        .toISOString()
        .slice(0, 10)}.csv"`,
    },
  });
}
