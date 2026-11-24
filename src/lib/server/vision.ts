"use server";

import OpenAI from "openai";
import {
  checkImages,
  parseExtraction,
  VISION_SYSTEM_PROMPT,
  type ExtractedRow,
} from "@/lib/screenshot_import";
import type { ActionResult } from "./items";

/**
 * Reading screenshots needs a model that can see images. It is configured on
 * its own, because the chat model (often a small local text model) usually
 * can't:
 *
 *   VISION_MODEL      required. e.g. "gpt-4o-mini", or a local "qwen2.5vl:7b"
 *   VISION_BASE_URL   optional, defaults to OPENAI_BASE_URL (else OpenAI)
 *   VISION_API_KEY    optional, defaults to OPENAI_API_KEY
 */

const REQUEST_TIMEOUT_MS = 120_000;

export type VisionStatus = {
  configured: boolean;
  model: string | null;
  /** Where screenshots are sent, so the person can see it before sending. */
  host: string | null;
  /** True when that host is this computer. */
  local: boolean;
};

function settings() {
  const model = process.env.VISION_MODEL?.trim() || null;
  const baseURL =
    process.env.VISION_BASE_URL?.trim() ||
    process.env.OPENAI_BASE_URL?.trim() ||
    undefined;
  const apiKey =
    process.env.VISION_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "ollama";
  return { model, baseURL, apiKey };
}

export async function getVisionStatus(): Promise<VisionStatus> {
  const { model, baseURL } = settings();
  let host: string | null = null;
  let local = false;
  try {
    const u = new URL(baseURL ?? "https://api.openai.com/v1");
    host = u.host;
    local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname);
  } catch {
    host = null;
  }
  return { configured: model != null, model, host, local };
}

/** A message a person can act on, never including the key. */
function explain(err: unknown, host: string | null, model: string): string {
  const status =
    typeof err === "object" && err && "status" in err
      ? Number((err as { status: unknown }).status)
      : null;
  const msg = err instanceof Error ? err.message : "";
  if (status === 401 || status === 403)
    return "The model server refused the API key. Check VISION_API_KEY (or OPENAI_API_KEY).";
  if (status === 404)
    return `The model server doesn't know a model called "${model}". Check VISION_MODEL.`;
  if (status === 429)
    return "The model server says you've hit a rate or spending limit. Try again in a bit.";
  if (status === 400 && /image|vision|multimodal/i.test(msg))
    return `"${model}" doesn't seem able to read images. Use a vision model for VISION_MODEL.`;
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|connect/i.test(msg))
    return `Couldn't reach ${host ?? "the model server"}. Is it running?`;
  if (/timed? ?out|abort/i.test(msg))
    return "The model took too long to answer. Try fewer screenshots at a time.";
  return "The model couldn't read these screenshots. Try again, or add the rows by hand.";
}

/**
 * Send the screenshots (already shrunk in the browser) to the vision model
 * and return the rows it could read. Nothing is saved: not the images, not
 * the reply. The rows still have to be reviewed and confirmed before they
 * become transactions.
 */
export async function extractFromScreenshots(input: {
  images: string[];
}): Promise<ActionResult<{ rows: ExtractedRow[]; rejected: number }>> {
  const images = Array.isArray(input?.images)
    ? input.images.filter((i): i is string => typeof i === "string")
    : [];
  const check = checkImages(images);
  if (!check.ok) return { ok: false, error: check.error };

  const { model, baseURL, apiKey } = settings();
  if (!model) {
    return {
      ok: false,
      error:
        "Reading screenshots isn't set up. Set VISION_MODEL in .env (see the note on this page).",
    };
  }
  const status = await getVisionStatus();

  try {
    const client = new OpenAI({
      apiKey,
      baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    const res = await client.chat.completions.create({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: VISION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read the purchases and sales in these screenshots.",
            },
            ...images.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: "high" as const },
            })),
          ],
        },
      ],
    });
    const reply = res.choices[0]?.message?.content ?? "";
    const { rows, rejected } = parseExtraction(reply);
    return { ok: true, data: { rows, rejected } };
  } catch (err) {
    return { ok: false, error: explain(err, status.host, model) };
  }
}
