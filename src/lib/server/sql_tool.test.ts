/**
 * Unit tests for the SQL parse guard. DB execution is not tested here
 * (integration territory — we rely on Postgres's own READ ONLY mode as
 * the final safety net).
 */

import { describe, expect, it } from "vitest";
import { _internal } from "./sql_tool";

const { guard, ensureLimit } = _internal;

describe("guard — allowed", () => {
  it.each([
    "SELECT 1",
    "select id, name from items",
    "  SELECT * FROM items WHERE name ilike '%etb%' LIMIT 10",
    "WITH held AS (SELECT * FROM items) SELECT count(*) FROM held",
    "select sum(final_value_cents) from transactions where type = 'buy'",
    "SELECT * FROM items; ",
  ])("accepts %s", (q) => {
    expect(guard(q)).toBeNull();
  });
});

describe("guard — rejected", () => {
  it.each([
    ["INSERT INTO items VALUES ('x')"],
    ["UPDATE items SET name = 'x'"],
    ["DELETE FROM items"],
    ["DROP TABLE items"],
    ["TRUNCATE items"],
    ["SELECT * FROM items; DROP TABLE items"],
    ["SELECT * FROM pg_catalog.pg_tables"],
    ["SELECT * FROM information_schema.tables"],
    ["SET statement_timeout = 0"],
    ["COPY items TO STDOUT"],
    [""],
    ["EXPLAIN SELECT 1"],
    ["/* hi */ DELETE FROM items"],
    ["SELECT 1; SELECT 2"],
  ])("rejects %s", (q) => {
    const result = guard(q);
    expect(result).not.toBeNull();
    expect(result?.error).toBeTruthy();
  });

  it("strips line comments before checking", () => {
    // Content after -- is a comment; the effective query is just "SELECT * FROM items"
    // and should be accepted.
    expect(guard("SELECT * FROM items -- ; DROP TABLE items\n")).toBeNull();
  });
});

describe("guard — column-name safety", () => {
  it("does not false-positive on identifiers containing a forbidden keyword", () => {
    // `\b` word-boundary correctly excludes `delete` inside `deleted_at`
    // because `_` is a word character, so there's no boundary between
    // the two. Regression guard against ever relaxing the regex.
    expect(guard("SELECT deleted_at FROM items")).toBeNull();
    expect(guard("SELECT created_at, updated_at FROM items")).toBeNull();
  });
});

describe("ensureLimit", () => {
  it("adds LIMIT when missing", () => {
    const { query, capApplied } = ensureLimit("SELECT * FROM items");
    expect(capApplied).toBe(true);
    expect(query).toMatch(/LIMIT 501/);
  });

  it("leaves existing LIMIT alone", () => {
    const { query, capApplied } = ensureLimit("SELECT * FROM items LIMIT 10");
    expect(capApplied).toBe(false);
    expect(query).toBe("SELECT * FROM items LIMIT 10");
  });

  it("case-insensitive LIMIT detection", () => {
    const { capApplied } = ensureLimit("SELECT * FROM items limit 5");
    expect(capApplied).toBe(false);
  });
});
