/**
 * Read-only SQL tool exposed to the chat LLM. Three layers of defense
 * so even a jailbroken prompt can't damage the DB:
 *
 *   1. Parse guard — the query must be a bare SELECT (or `WITH ... SELECT`)
 *      and cannot mention any DDL/DML keyword, `pg_*` table, `SET`, or
 *      `COPY`. Prevents obvious attacks before the DB even sees the query.
 *   2. Session-level `SET TRANSACTION READ ONLY` — Postgres itself will
 *      refuse any write, even if the parse guard misses something.
 *   3. `statement_timeout = 5s` — a runaway scan self-cancels.
 *
 * Also enforces a row cap (default 500) — if the query doesn't already
 * carry a LIMIT, we append one. Truncation is signalled back so the LLM
 * can tell the user.
 */

import { pgClient } from "@/db/client";

export type SqlResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};

export type SqlToolError = {
  error: string;
  hint?: string;
};

const MAX_ROWS = 500;
const STATEMENT_TIMEOUT_MS = 5000;

// Tokens that must never appear in the query. Word-boundary regex so
// substrings inside identifiers (e.g. `insert_time`) don't trip.
const FORBIDDEN = [
  "insert",
  "update",
  "delete",
  "drop",
  "truncate",
  "alter",
  "create",
  "grant",
  "revoke",
  "vacuum",
  "analyze",
  "reindex",
  "cluster",
  "copy",
  "listen",
  "notify",
  "call",
  "do",
  "set",
  "reset",
  "begin",
  "commit",
  "rollback",
  "savepoint",
  "lock",
  "checkpoint",
  "prepare",
  "execute",
  "deallocate",
];

function guard(rawQuery: string): SqlToolError | null {
  const q = rawQuery.trim();
  if (!q) return { error: "Empty query." };
  // Strip line + block comments FIRST so an attacker can't hide a
  // semicolon or a forbidden keyword inside `-- ...` or `/* ... */`.
  const withoutComments = q
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ");
  // Strip trailing semicolons, then reject any remaining inline
  // semicolon (statement stacking).
  const stripped = withoutComments.replace(/;+\s*$/, "");
  if (stripped.includes(";")) {
    return { error: "Multiple statements are not allowed." };
  }

  const lower = stripped.toLowerCase();

  // Must start with SELECT or WITH (for CTEs).
  const startMatch = lower.match(/^\s*(select|with)\b/);
  if (!startMatch) {
    return {
      error: "Only SELECT queries (optionally starting with WITH) are allowed.",
    };
  }

  // Forbidden keyword scan — word-boundary so substrings don't false-hit.
  for (const kw of FORBIDDEN) {
    const re = new RegExp(`\\b${kw}\\b`, "i");
    if (re.test(lower)) {
      return { error: `Keyword not allowed: ${kw.toUpperCase()}` };
    }
  }

  // Block system-catalog / information_schema access to avoid leaking
  // metadata that might help craft an attack (and to keep results
  // focused on user data).
  if (/\bpg_[a-z_]+/i.test(lower) || /\binformation_schema\b/i.test(lower)) {
    return {
      error:
        "Access to system catalogs (pg_*, information_schema) is not allowed.",
    };
  }

  return null;
}

function ensureLimit(query: string): { query: string; capApplied: boolean } {
  // If the query already has a LIMIT, honor it. Otherwise wrap.
  if (/\blimit\s+\d+/i.test(query)) return { query, capApplied: false };
  const trimmed = query.trim().replace(/;+\s*$/, "");
  return { query: `${trimmed}\nLIMIT ${MAX_ROWS + 1}`, capApplied: true };
}

/**
 * Execute a read-only SELECT. Returns rows or a structured error the
 * chat handler can pass back to the LLM as tool output.
 */
export async function runReadOnlySql(
  query: string,
): Promise<SqlResult | SqlToolError> {
  const guardError = guard(query);
  if (guardError) return guardError;

  const { query: safeQuery, capApplied } = ensureLimit(query);

  try {
    // Wrap in a transaction so we can set the read-only mode + timeout
    // and have them auto-revert.
    return await pgClient.begin(async (sql) => {
      await sql.unsafe(`SET TRANSACTION READ ONLY`);
      await sql.unsafe(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
      const rows = await sql.unsafe(safeQuery);
      const truncated = capApplied && rows.length > MAX_ROWS;
      const clipped = truncated ? rows.slice(0, MAX_ROWS) : rows;
      const columns = clipped.length > 0 ? Object.keys(clipped[0]) : [];
      return {
        columns,
        rows: clipped as Record<string, unknown>[],
        rowCount: clipped.length,
        truncated,
      };
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: `Query failed: ${message}`,
      hint: message.includes("read-only")
        ? "The session is read-only — only SELECT queries work."
        : message.includes("statement timeout")
          ? "The query took too long (>5s). Add a WHERE clause or LIMIT to narrow it."
          : undefined,
    };
  }
}

// Exposed for unit tests.
export const _internal = { guard, ensureLimit };
