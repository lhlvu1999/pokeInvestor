import { ChatUI } from "./ChatUI";

export const dynamic = "force-dynamic";

export default function AskPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Ask your portfolio</h1>
        <p className="text-xs text-zinc-500 mt-1">
          Natural-language questions over your items, transactions, market
          prices, and creator insights. Uses your local LLM (Ollama) with
          read-only SQL access — no data leaves the machine.
        </p>
      </div>
      <ChatUI />
    </div>
  );
}
