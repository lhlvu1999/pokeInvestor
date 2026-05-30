"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { prompts, type Prompt } from "@/db/schema";
import { YOUTUBE_INSIGHT_PROMPT_NAME } from "@/lib/youtube-constants";
import type { ActionResult } from "./items";

/* ------------------------------------------------------------------ */
/* Default seed                                                        */
/* ------------------------------------------------------------------ */

/**
 * JSON Schema enforced by OpenAI structured outputs. Mirrors what the Python
 * pipeline flattens into `youtube_insight_mentions`. Schema rules:
 *   - every property of every object is in `required`
 *   - `additionalProperties: false` everywhere
 *   - nullable fields use `"type": ["string", "null"]` syntax
 * These constraints are what OpenAI's strict mode requires.
 */
const DEFAULT_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "summary",
    "overall_sentiment",
    "time_horizon",
    "mentions",
    "price_calls",
    "notable_quotes",
  ],
  properties: {
    summary: {
      type: "string",
      description: "2–3 sentence neutral summary of the video's investment angle.",
    },
    overall_sentiment: {
      type: "string",
      enum: ["bullish", "bearish", "neutral", "mixed"],
    },
    time_horizon: {
      type: ["string", "null"],
      enum: ["short", "medium", "long", null],
      description: "Short = weeks, medium = months, long = year+.",
    },
    mentions: {
      type: "array",
      description: "Specific Pokémon products or cards mentioned with an opinion.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "set_hint",
          "product_type",
          "sentiment",
          "confidence",
          "timestamp_sec",
          "quote",
        ],
        properties: {
          name: {
            type: "string",
            description: "Card or product name as spoken, e.g. 'Charizard 4/102'.",
          },
          set_hint: {
            type: ["string", "null"],
            description: "Set name or era if mentioned, e.g. 'Base Set', 'WOTC'.",
          },
          product_type: {
            type: ["string", "null"],
            enum: [
              "single",
              "sealed",
              "slab",
              "etb",
              "booster_box",
              "booster_pack",
              "tin",
              "bundle",
              "other",
              null,
            ],
          },
          sentiment: {
            type: "string",
            enum: ["bullish", "bearish", "neutral"],
          },
          confidence: {
            type: "number",
            description: "0..1 how clearly the speaker expressed this opinion.",
          },
          timestamp_sec: {
            type: ["integer", "null"],
            description: "Offset into the video, if known.",
          },
          quote: {
            type: ["string", "null"],
            description: "Verbatim or near-verbatim quote backing this mention.",
          },
        },
      },
    },
    price_calls: {
      type: "array",
      description: "Forward-looking price predictions, even if vague.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["subject", "direction", "target", "rationale"],
        properties: {
          subject: { type: "string" },
          direction: { type: "string", enum: ["up", "down", "flat"] },
          target: {
            type: ["string", "null"],
            description: "Free-form target, e.g. '$500', '2x current', null if vague.",
          },
          rationale: { type: ["string", "null"] },
        },
      },
    },
    notable_quotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "timestamp_sec"],
        properties: {
          text: { type: "string" },
          timestamp_sec: { type: ["integer", "null"] },
        },
      },
    },
  },
} as const;

const DEFAULT_SYSTEM_TEXT = `You analyze YouTube videos about Pokémon trading-card investing.

Your job: extract every actionable opinion the speaker(s) express about specific cards, sealed products, or the market overall. Be conservative — do not invent opinions. If the video is purely entertainment with no investment angle, return empty arrays and "neutral" sentiment.

Glossary (do not explain back to me; just use it):
  - ETB: Elite Trainer Box (sealed product, typically ~9 packs + accessories)
  - Booster Box: 36 sealed packs from a set
  - WOTC: Wizards of the Coast — original Pokémon TCG era (1999–2003)
  - Slab: graded card in a PSA/CGC/Beckett case
  - Sealed: any unopened factory product
  - "Pop": population report (count of graded copies at a grade)

Sentiment definitions:
  - bullish: speaker expects the price/desirability to rise
  - bearish: speaker expects the price to fall or warns against buying
  - neutral: speaker mentions but expresses no directional view
  - mixed (overall only): different signals across the video

Always return valid JSON matching the provided schema. Use null for unknown optional fields rather than guessing.`;

const DEFAULT_USER_TEMPLATE = `Video title: {{title}}

Transcript:
{{transcript}}`;

/* ------------------------------------------------------------------ */
/* Idempotent seed                                                     */
/* ------------------------------------------------------------------ */

/**
 * Ensures the default YouTube insight-extraction prompt exists. Safe to call
 * on every page load — does nothing if any version of the prompt already
 * exists for the canonical name.
 */
export async function ensureDefaultPrompts(): Promise<void> {
  const existing = await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(eq(prompts.name, YOUTUBE_INSIGHT_PROMPT_NAME))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(prompts).values({
    name: YOUTUBE_INSIGHT_PROMPT_NAME,
    version: 1,
    model: "gpt-4o-mini",
    temperature: 0.2,
    systemText: DEFAULT_SYSTEM_TEXT,
    userTemplate: DEFAULT_USER_TEMPLATE,
    responseSchema: DEFAULT_RESPONSE_SCHEMA,
    isActive: true,
    createdBy: "system",
  });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function listPrompts(name?: string): Promise<Prompt[]> {
  if (name) {
    return db
      .select()
      .from(prompts)
      .where(eq(prompts.name, name))
      .orderBy(desc(prompts.version));
  }
  return db
    .select()
    .from(prompts)
    .orderBy(desc(prompts.createdAt));
}

export async function getActivePrompt(name: string): Promise<Prompt | null> {
  const rows = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.name, name), eq(prompts.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPromptById(id: string): Promise<Prompt | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const rows = await db.select().from(prompts).where(eq(prompts.id, id)).limit(1);
  return rows[0] ?? null;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

/**
 * Cheap structural check that `value` is something resembling a JSON Schema
 * for our extraction use case: must be an object with `type: "object"` and a
 * non-empty `properties` object. Catches the common foot-gun of pasting an
 * *example output* into the schema field instead of the schema itself.
 *
 * We deliberately don't run a full JSON-Schema-meta-schema validator —
 * that's a 50KB dependency for one editor screen — and we don't need to;
 * OpenAI strict mode will reject anything subtly wrong at request time.
 */
function looksLikeJsonSchema(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (obj.type !== "object") return false;
  const props = obj.properties;
  if (props === null || typeof props !== "object" || Array.isArray(props)) {
    return false;
  }
  return Object.keys(props as Record<string, unknown>).length > 0;
}

const saveSchema = z.object({
  name: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(100),
  /** Some models (o-series) reject `temperature`; pass null in that case. */
  temperature: z.number().min(0).max(2).nullable(),
  systemText: z.string().min(1, "System prompt cannot be empty"),
  userTemplate: z.string().min(1, "User template cannot be empty"),
  /** JSON Schema object enforced by OpenAI structured outputs. */
  responseSchema: z.unknown().refine(
    looksLikeJsonSchema,
    'Response schema must be a JSON Schema with `"type": "object"` and a non-empty `properties` object — not an example output.',
  ),
  createdBy: z.string().trim().max(200).optional(),
});

export type SavePromptInput = z.input<typeof saveSchema>;

/**
 * Saves a new version of a prompt and atomically makes it the active version.
 * Old rows are not mutated — `youtube_insights.prompt_id` keeps every historic
 * insight tied to the exact prompt that produced it.
 */
export async function savePromptVersion(
  raw: SavePromptInput,
): Promise<ActionResult<Prompt>> {
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  try {
    const created = await db.transaction(async (tx) => {
      // Compute next version. Uses COALESCE so the first version is 1.
      const [versionRow] = await tx
        .select({
          next: sql<number>`COALESCE(MAX(${prompts.version}), 0) + 1`,
        })
        .from(prompts)
        .where(eq(prompts.name, input.name));
      const nextVersion = versionRow?.next ?? 1;

      // Demote the currently-active row (if any) before inserting the new
      // active row. The partial unique index `(name) WHERE is_active` would
      // otherwise reject the insert.
      await tx
        .update(prompts)
        .set({ isActive: false })
        .where(and(eq(prompts.name, input.name), eq(prompts.isActive, true)));

      const [row] = await tx
        .insert(prompts)
        .values({
          name: input.name,
          version: nextVersion,
          model: input.model,
          temperature: input.temperature,
          systemText: input.systemText,
          userTemplate: input.userTemplate,
          responseSchema: input.responseSchema as object,
          isActive: true,
          createdBy: input.createdBy ?? null,
        })
        .returning();
      return row;
    });

    revalidatePath("/admin/prompts");
    return { ok: true, data: created };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to save prompt",
    };
  }
}

/**
 * Rollback to a previous version: marks the (name, version) row active and
 * demotes whatever was active before. No-op if the target is already active.
 */
export async function setActivePromptVersion(
  name: string,
  version: number,
): Promise<ActionResult<null>> {
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: "Invalid version" };
  }
  try {
    await db.transaction(async (tx) => {
      const target = await tx
        .select({ id: prompts.id, isActive: prompts.isActive })
        .from(prompts)
        .where(and(eq(prompts.name, name), eq(prompts.version, version)))
        .limit(1);
      if (!target[0]) throw new Error("Prompt version not found");
      if (target[0].isActive) return; // already active — nothing to do

      await tx
        .update(prompts)
        .set({ isActive: false })
        .where(and(eq(prompts.name, name), eq(prompts.isActive, true)));
      await tx
        .update(prompts)
        .set({ isActive: true })
        .where(eq(prompts.id, target[0].id));
    });
    revalidatePath("/admin/prompts");
    return { ok: true, data: null };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to switch version",
    };
  }
}
