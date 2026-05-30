import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  const client = postgres(databaseUrl);
  const db = drizzle(client, { schema });

  console.log("Clearing existing data...");
  await db.delete(schema.marketPrices);
  await db.delete(schema.transactions);
  await db.delete(schema.items);
  await db.delete(schema.appSettings);
  await db.delete(schema.fxRates);

  console.log("Seeding items + transactions (VND)...");
  const [etbJourney] = await db
    .insert(schema.items)
    .values({
      name: "etb journey together",
    })
    .returning();
  const [etbDestined] = await db
    .insert(schema.items)
    .values({
      name: "etb destined rivals",
      sourceUrl:
        "https://www.tcgplayer.com/product/624676/pokemon-sv10-destined-rivals-destined-rivals-elite-trainer-box?Language=English",
    })
    .returning();
  const [pikachuUSD] = await db
    .insert(schema.items)
    .values({
      name: "Pikachu Illustrator (USD market)",
    })
    .returning();

  await db.insert(schema.transactions).values([
    {
      itemId: etbJourney.id,
      type: "buy",
      quantity: 1,
      finalValueCents: 1_850_000,
      currency: "VND",
      occurredAt: new Date("2025-10-11T10:00:00Z"),
    },
    {
      itemId: etbJourney.id,
      type: "sell",
      quantity: 1,
      finalValueCents: 2_800_000,
      currency: "VND",
      occurredAt: new Date("2026-05-03T10:00:00Z"),
    },
    {
      itemId: etbDestined.id,
      type: "buy",
      quantity: 1,
      finalValueCents: 2_760_000,
      currency: "VND",
      occurredAt: new Date("2025-10-20T10:00:00Z"),
    },
    {
      itemId: pikachuUSD.id,
      type: "buy",
      quantity: 1,
      finalValueCents: 5_000_00,
      currency: "USD",
      occurredAt: new Date("2026-01-15T10:00:00Z"),
    },
  ]);

  await db.insert(schema.marketPrices).values([
    {
      itemId: etbDestined.id,
      priceCents: 6_000_000,
      currency: "VND",
      source: "manual",
    },
    {
      itemId: pikachuUSD.id,
      priceCents: 6_000_00,
      currency: "USD",
      source: "manual",
    },
  ]);

  await db.insert(schema.appSettings).values({
    key: "display_currency",
    value: "VND",
  });

  console.log("Done.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
