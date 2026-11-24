import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { missingFromDatabase } from "./schema_check";
import { SCHEMA_STATEMENTS } from "./sync_statements";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");

  // Notices ("already exists, skipping") are expected on a re-run; hide them.
  const migrationClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const db = drizzle(migrationClient);

  console.log("Running migrations...");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");

  // The migrations above are the original schema; everything added since is in
  // these idempotent statements (the same ones the admin page's "Sync schema"
  // runs). Applying them here means a fresh install is complete from the start.
  console.log("Bringing the schema up to date...");
  let failed = 0;
  for (const stmt of SCHEMA_STATEMENTS) {
    try {
      // One statement at a time: some (ALTER TYPE ADD VALUE) cannot share a transaction.
      await migrationClient.unsafe(stmt);
    } catch (err) {
      failed += 1;
      console.error(`Failed: ${stmt.split("\n")[0].trim()}\n  ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed > 0) throw new Error(`${failed} schema statement(s) failed.`);

  // Prove it: the code and the database must now agree. If someone changes
  // schema.ts and forgets the matching statement, this says so here, not when a
  // page fails later.
  const missing = await missingFromDatabase(databaseUrl);
  if (missing.length > 0) {
    throw new Error(
      `The schema is still missing: ${missing.join(", ")}. Add the matching statement to src/db/sync_statements.ts.`,
    );
  }
  console.log("Schema is up to date.");

  await migrationClient.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
