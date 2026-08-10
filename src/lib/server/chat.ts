/**
 * Chat handler — runs the tool-use loop against an OpenAI-compatible
 * endpoint (typically local Ollama). Exposes one tool: `run_sql`. The
 * LLM writes a SELECT, we execute it under the safety guard, and hand
 * the results back so it can narrate the answer.
 *
 * Kept synchronous (no streaming) for MVP. A 7B model on Apple Silicon
 * running a schema-hint-heavy prompt is 10-30s per turn; streaming is a
 * later polish.
 */

import OpenAI from "openai";
import { runReadOnlySql } from "./sql_tool";
import { SCHEMA_DOC } from "./schema_docs";

export type ChatMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
};

export type ToolCallTrace = {
  query: string;
  ok: boolean;
  rowCount?: number;
  truncated?: boolean;
  error?: string;
};

export type ChatResult = {
  reply: string;
  trace: ToolCallTrace[];
  turns: number;
};

const MAX_TURNS = 4;
const REQUEST_TIMEOUT_MS = 120_000;

const SYSTEM_PROMPT = `You are the analyst for a Pokémon TCG collector's
personal portfolio-tracking app.

Answer the user's question by querying the database. Call the \`run_sql\`
tool to run one SELECT at a time. When you have the data, respond in a
short natural-language answer — 1-3 sentences plus a small table if it
helps. Always include the currency code next to any money number.

If a query returns zero rows or an error, explain briefly what you tried
and either refine and retry (up to a couple of attempts) or ask the user
to clarify.

${SCHEMA_DOC}
`;

const TOOL_DEFS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "run_sql",
      description:
        "Execute a read-only SELECT (or WITH...SELECT) against the portfolio database. Returns rows or an error.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The SQL query. Must be a bare SELECT.",
          },
        },
        required: ["query"],
      },
    },
  },
];

function client(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY ?? "ollama",
    baseURL: process.env.OPENAI_BASE_URL ?? undefined,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

function model(): string {
  return process.env.LLM_MODEL ?? "qwen2.5:7b";
}

/**
 * Run a full chat turn: user question in → LLM answer out. Executes
 * the tool-use loop up to MAX_TURNS iterations. Returns both the final
 * reply and a trace of every SQL call so the UI can show what happened.
 */
export async function runChat(
  userMessages: { role: "user" | "assistant"; content: string }[],
): Promise<ChatResult> {
  const openai = client();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...userMessages,
  ];

  const trace: ToolCallTrace[] = [];
  let turns = 0;

  while (turns < MAX_TURNS) {
    turns += 1;
    const response = await openai.chat.completions.create({
      model: model(),
      messages,
      tools: TOOL_DEFS,
      temperature: 0.1,
    });
    const choice = response.choices[0];
    const msg = choice?.message;
    if (!msg) throw new Error("Empty LLM response");

    // No tool calls → this is the final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return {
        reply: msg.content ?? "(empty)",
        trace,
        turns,
      };
    }

    // Record the assistant's tool-call turn verbatim so the follow-up
    // "tool" messages line up with the call ids the model emitted.
    messages.push(msg);

    for (const call of msg.tool_calls) {
      if (call.type !== "function" || call.function.name !== "run_sql") {
        const err = `Unknown tool: ${call.type}/${"function" in call ? call.function.name : "?"}`;
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: err }),
        });
        trace.push({ query: "(unknown tool)", ok: false, error: err });
        continue;
      }
      let args: { query?: string } = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "Malformed tool arguments" }),
        });
        trace.push({
          query: call.function.arguments,
          ok: false,
          error: "Malformed tool arguments",
        });
        continue;
      }
      const query = String(args.query ?? "").trim();
      const result = await runReadOnlySql(query);
      if ("error" in result) {
        trace.push({ query, ok: false, error: result.error });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            error: result.error,
            hint: result.hint,
          }),
        });
      } else {
        trace.push({
          query,
          ok: true,
          rowCount: result.rowCount,
          truncated: result.truncated,
        });
        // Cap the payload sent back to the LLM — big result sets blow the
        // context. 40 rows is usually enough to describe a pattern; the
        // full result set is still shown to the user in the trace.
        const previewRows = result.rows.slice(0, 40);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            columns: result.columns,
            rows: previewRows,
            rowCount: result.rowCount,
            truncated: result.truncated,
            note:
              previewRows.length < result.rowCount
                ? `Showing first ${previewRows.length} of ${result.rowCount} rows.`
                : undefined,
          }),
        });
      }
    }
  }

  return {
    reply:
      "I ran out of turns before landing on an answer — try a simpler question or narrow the scope.",
    trace,
    turns,
  };
}
