import { describe, expect, it } from "vitest";
import {
  DELETED_RETENTION_DAYS,
  daysLeft,
  expiresAt,
  purgeBefore,
} from "./recently_deleted";

const d = (iso: string) => new Date(iso);

describe("recently deleted retention", () => {
  const deleted = d("2026-11-01T12:00:00Z");

  it("keeps a row for the full retention window", () => {
    expect(daysLeft(deleted, deleted)).toBe(DELETED_RETENTION_DAYS);
  });

  it("rounds a partial day up", () => {
    expect(daysLeft(deleted, d("2026-11-01T18:00:00Z"))).toBe(30);
    expect(daysLeft(deleted, d("2026-11-30T18:00:00Z"))).toBe(1);
  });

  it("reaches zero at and after expiry, never negative", () => {
    expect(daysLeft(deleted, expiresAt(deleted))).toBe(0);
    expect(daysLeft(deleted, d("2027-03-01T00:00:00Z"))).toBe(0);
  });

  it("purges exactly what has expired", () => {
    const now = d("2026-12-01T12:00:00Z");
    expect(purgeBefore(now).toISOString()).toBe("2026-11-01T12:00:00.000Z");
  });
});
