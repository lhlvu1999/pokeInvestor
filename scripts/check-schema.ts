/**
 * Compares what the code expects (src/db/schema.ts) with a real database, and
 * lists every table or column that is missing. Read-only.
 *
 *   npm run check:schema                      (uses DATABASE_URL from .env)
 *   DATABASE_URL=... npm run check:schema     (any other database)
 *
 * Exit code 0 when the database has everything, 1 otherwise. The same check runs
 * after `npm run db:migrate`, so a fresh install that is missing something is
 * noticed straight away instead of when a page fails.
 */
import { missingFromDatabase } from "../src/db/schema_check";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const missing = await missingFromDatabase(url);
  if (missing.length === 0) {
    console.log("The database has every table and column the code expects.");
    return;
  }
  console.log(`The database is missing ${missing.length} thing(s):`);
  for (const m of missing) console.log("  " + m);
  process.exit(1);
}

// Run only when started directly, not when imported by another script.
if (process.argv[1] && /check-schema\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
