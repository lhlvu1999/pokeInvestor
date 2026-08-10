import { NextResponse } from "next/server";
import { runChat, type ChatMessage } from "@/lib/server/chat";

/**
 * POST /api/ask
 *
 * Body: { messages: [{ role: "user" | "assistant", content: string }] }
 * Response: { reply: string, trace: ToolCallTrace[], turns: number }
 *
 * All state lives client-side — server is stateless. The Ollama call
 * itself can take 10-30s on a 7B local model; caller should show a
 * spinner.
 */
export async function POST(req: Request) {
  let body: { messages?: ChatMessage[] } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const messages = (body.messages ?? []).filter(
    (m): m is { role: "user" | "assistant"; content: string } =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0,
  );
  if (messages.length === 0) {
    return NextResponse.json(
      { error: "At least one user message is required" },
      { status: 400 },
    );
  }
  if (messages[messages.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Last message must be from the user" },
      { status: 400 },
    );
  }

  try {
    const result = await runChat(messages);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Ollama-not-running / model-missing typically manifests as a
    // Connection error or 404. Surface a friendlier message.
    const friendly = message.includes("Connection error")
      ? "Can't reach the LLM. Is Ollama running? Try `brew services start ollama`."
      : message.includes("404")
        ? `Model '${process.env.LLM_MODEL ?? "qwen2.5:7b"}' not found. Try 'ollama pull ${process.env.LLM_MODEL ?? "qwen2.5:7b"}'.`
        : message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
}
