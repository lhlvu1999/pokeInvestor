import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sealedType } from "./sealed_type";

describe("sealedType", () => {
  it.each([
    ["Lost Origin Booster Box", "box"],
    ["Neo Genesis Booster Box [Unlimited Edition]", "box"],
    ["Collection Sun Booster Box", "box"],
    ["25th Anniversary Collection Booster Box", "box"],
    ["Expansion Pack 20th Anniversary - Booster Box (1st Edition)", "box"],
    ["Guardians Rising Elite Trainer Box", "etb"],
    ["Pitch Black Elite Trainer Box", "etb"],
    ["Prismatic Evolution Booster Bundle", "bundle"],
    ["151 Booster Bundle", "bundle"],
    ["Black Bolt Booster Pack", "pack"],
    ["Sun & Moon Booster Pack", "pack"],
  ])("%s is a %s", (name, expected) => {
    expect(sealedType(name)).toBe(expected);
  });

  it.each([
    "Crimson Haze Booster Box Case",
    "Fusion Strike Booster Box Case",
    "Pitch Black Half Booster Box",
    "Stellar Crown Half Booster Box",
    "Twilight Masquerade Build & Battle Box Display",
    "Prismatic Evolutions Mini Tin Display Case",
    "Surging Sparks Pokemon Center Elite Trainer Box (Exclusive)",
    "Chilling Reign Pokemon Center Elite Trainer Box Case (Exclusive)",
    "Pitch Black Elite Trainer Box Case",
    "Prismatic Evolution Booster Bundle Display Case",
    "151 Booster Bundle Bulk Case",
    "Silver Tempest Sleeved Booster Pack Case",
    "Temporal Forces Sleeved Booster",
    "Shrouded Fable 3 Pack Blister Case",
    "Team Up - Mini Booster Pack",
    "Delta Reign Single Pack Blister (Target Exclusive) [Keldeo]",
    "Forbidden Light Theme Deck Display",
    "Charizard ex Special Collection",
    "Poke Ball Tin Display (Q3 2019)",
    "Flowing Fists Booster Pack Art Bundle (Set of 4)",
    "Evolutions Booster Pack Art Bundle [Set of 4]",
    "Sun & Moon Sleeved Booster Pack Art Bundle [Set of 5]",
  ])("%s is not tracked", (name) => {
    expect(sealedType(name)).toBeNull();
  });
});

describe("agreement with the Python classifier", () => {
  // The same file is checked by pipeline/tests/test_sealed_type.py.
  const vectors: [string, string | null][] = JSON.parse(
    readFileSync(
      "pipeline/tests/fixtures/sealed_type_vectors.json",
      "utf8",
    ),
  );

  it("gives every shared vector its recorded kind", () => {
    const wrong = vectors.filter(([name, kind]) => sealedType(name) !== kind);
    expect(wrong).toEqual([]);
    expect(vectors.length).toBeGreaterThan(1000);
  });
});
