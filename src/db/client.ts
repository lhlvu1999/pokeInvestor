import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const globalForDb = globalThis as unknown as {
  pgClient?: ReturnType<typeof postgres>;
};

// On Vercel every function instance opens its own connections, and the hosted
// database sits behind a transaction pooler (PgBouncer), which cannot reuse a
// prepared statement across connections. So there: few connections, no
// prepared statements, and idle ones are dropped before the instance sleeps.
// Everywhere else (your computer, Docker) the settings are what they always were.
const onVercel = Boolean(process.env.VERCEL);

export const pgClient =
  globalForDb.pgClient ??
  postgres(
    databaseUrl,
    onVercel
      ? { max: 3, prepare: false, idle_timeout: 20, connect_timeout: 15 }
      : { max: 10 },
  );

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = pgClient;
}

export const db = drizzle(pgClient, { schema });
export type Database = typeof db;
