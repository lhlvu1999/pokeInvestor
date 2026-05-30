/**
 * Constants shared between client/server modules. Kept here (not in a
 * `"use server"` file) because Next.js only allows async function exports
 * from server-action modules.
 */

/**
 * Canonical name for the YouTube insight-extraction prompt. The Python
 * pipeline looks this name up in the `prompts` table.
 */
export const YOUTUBE_INSIGHT_PROMPT_NAME = "youtube_insight_extraction";
