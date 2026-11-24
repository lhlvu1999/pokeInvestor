/**
 * Does the configured vision model read screenshots the way the importer
 * needs? Sends made-up screenshots (tests/fixtures/vision) through the same
 * code the Import page uses and grades the answers strictly: a wrong value,
 * a row that isn't on the page, or a row the prompt said to leave out is a
 * failure; leaving out a readable row is reported but isn't unsafe.
 *
 *   npm run check:vision            uses VISION_MODEL / VISION_BASE_URL / VISION_API_KEY
 *   npm run check:vision:selftest   proves this checker with a stand-in model
 *                                   (add `-- --verbose` to see its reports)
 *
 * The screenshots are synthetic: no data of yours is sent anywhere.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { AddressInfo } from "node:net";
import {
  compareExtraction,
  type CheckReport,
  type Expected,
} from "@/lib/screenshot_check";
import { extractFromScreenshots, getVisionStatus } from "@/lib/server/vision";

const DIR = path.join(process.cwd(), "tests", "fixtures", "vision");

type Fixture = { name: string; dataUrl: string; expected: Expected };

function loadFixtures(): Fixture[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => {
      const name = f.replace(/\.png$/, "");
      const png = readFileSync(path.join(DIR, f));
      return {
        name,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
        expected: JSON.parse(
          readFileSync(path.join(DIR, `${name}.expected.json`), "utf8"),
        ) as Expected,
      };
    });
}

type Outcome =
  | { name: string; error: string }
  | { name: string; report: CheckReport; note?: string };

async function checkAll(fixtures: Fixture[]): Promise<Outcome[]> {
  const out: Outcome[] = [];
  for (const f of fixtures) {
    const res = await extractFromScreenshots({ images: [f.dataUrl] });
    out.push(
      res.ok
        ? {
            name: f.name,
            report: compareExtraction(f.expected, res.data.rows, res.data.rejected),
            note: f.expected.note,
          }
        : { name: f.name, error: res.error },
    );
  }
  return out;
}

function printOutcome(o: Outcome): void {
  console.log(`\n── ${o.name}`);
  if ("error" in o) {
    console.log(`   ERROR  ${o.error}`);
    return;
  }
  if (o.note) console.log(`   ${o.note}`);
  const r = o.report;
  for (const row of r.rows) {
    const mark = row.status === "correct" ? "ok     " : row.status === "wrong" ? "WRONG  " : "missing";
    console.log(`   ${mark} ${row.expected.item}`);
    for (const d of row.differences) console.log(`            ${d}`);
    for (const n of row.notes) console.log(`            (${n})`);
  }
  for (const x of r.invented) console.log(`   INVENTED ${x.item} (${x.dateIn}, ${x.amountIn}): not on the page`);
  for (const x of r.forbidden)
    console.log(`   SHOULD HAVE LEFT OUT ${x.item} (${x.dateIn}, ${x.amountIn})`);
  if (r.rejected > 0) console.log(`   (${r.rejected} row(s) in the reply were thrown out by the importer's own checks)`);
  console.log(
    `   ${r.correct} correct, ${r.wrong} wrong, ${r.missing} missing, ${r.invented.length} invented, ${r.forbidden.length} should have been left out`,
  );
}

const verdict = (os: Outcome[]) => ({
  safe: os.every((o) => "report" in o && o.report.safe),
  complete: os.every((o) => "report" in o && o.report.complete),
});

// ── the stand-in model (for --selftest) ────────────────────────────────

type Mode = "perfect" | "fenced" | "flawed";

function startStandIn(fixtures: Fixture[]) {
  const byUrl = new Map(
    fixtures.map((f) => [createHash("sha1").update(f.dataUrl).digest("hex"), f]),
  );
  let mode: Mode = "perfect";

  const reply = (f: Fixture): string => {
    const rows = f.expected.rows.map((r) => ({ ...r }));
    if (mode === "flawed") {
      if (rows.length > 0) rows[0].amountIn = Math.round(rows[0].amountIn * 1.1); // misread
      if (f.expected.mustOmit?.length) {
        rows.push({
          item: `${f.expected.mustOmit[0]} Elite Trainer Box`,
          quantity: 2,
          dateIn: "2026-04-03",
          amountIn: 4200000,
          dateOut: null,
          amountOut: null,
        }); // a guess the prompt forbids
      }
      rows.push({
        item: "Phantom Booster Box",
        quantity: 1,
        dateIn: "2026-01-01",
        amountIn: 1,
        dateOut: null,
        amountOut: null,
      }); // not on the page
    }
    const json = JSON.stringify({ rows });
    return mode === "fenced" ? "```json\n" + json + "\n```" : json;
  };

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      let content = '{"rows":[]}';
      try {
        const msg = JSON.parse(body).messages?.[1]?.content as
          | { type: string; image_url?: { url: string } }[]
          | undefined;
        const url = msg?.find((p) => p.type === "image_url")?.image_url?.url ?? "";
        const f = byUrl.get(createHash("sha1").update(url).digest("hex"));
        if (f) content = reply(f);
      } catch {
        // fall through to an empty reply
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: "standin",
          object: "chat.completion",
          created: 0,
          model: "stand-in",
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        }),
      );
    });
  });
  return {
    listen: () =>
      new Promise<number>((resolve) =>
        server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port)),
      ),
    close: () => server.close(),
    setMode: (m: Mode) => (mode = m),
  };
}

async function selftest(fixtures: Fixture[]): Promise<number> {
  const standIn = startStandIn(fixtures);
  const port = await standIn.listen();
  process.env.VISION_MODEL = "stand-in";
  process.env.VISION_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.VISION_API_KEY = "stand-in";
  let ok = true;
  try {
    for (const mode of ["perfect", "fenced", "flawed"] as const) {
      standIn.setMode(mode);
      const outcomes = await checkAll(fixtures);
      const v = verdict(outcomes);
      const want = mode !== "flawed";
      // A flawed model must fail EVERY fixture, or the checker is missing something.
      const everyFails = outcomes.every((o) => "report" in o && !o.report.safe);
      const passed = want ? v.safe && v.complete : everyFails;
      ok &&= passed;
      console.log(
        `${passed ? "PASS" : "FAIL"}  stand-in "${mode}": ${
          want ? "checker accepts a correct model" : "checker rejects a flawed model on every fixture"
        }`,
      );
      if (!passed || process.argv.includes("--verbose")) {
        console.log(`  --- what the checker saw from the "${mode}" model:`);
        outcomes.forEach(printOutcome);
      }
    }
  } finally {
    standIn.close();
  }
  console.log(ok ? "\nSelf-test passed." : "\nSelf-test FAILED.");
  return ok ? 0 : 1;
}

async function main(): Promise<number> {
  const fixtures = loadFixtures();
  if (process.argv.includes("--selftest")) return selftest(fixtures);

  const status = await getVisionStatus();
  if (!status.configured) {
    console.log(
      [
        "No vision model is configured, so there is nothing to check.",
        "",
        "Set VISION_MODEL in .env to a model that can read images, for example:",
        "  - a local one:  ollama pull qwen2.5vl:7b   then   VISION_MODEL=qwen2.5vl:7b",
        "    (the base URL falls back to OPENAI_BASE_URL, e.g. http://localhost:11434/v1)",
        "  - or a hosted one: VISION_MODEL=gpt-4o-mini with an API key",
        "",
        "Then run this again. `npm run check:vision:selftest` shows the checker works.",
      ].join("\n"),
    );
    return 2;
  }
  console.log(
    `Checking "${status.model}" at ${status.host ?? "OpenAI"}${status.local ? " (this computer)" : ""}`,
  );
  console.log(`Sending ${fixtures.length} made-up screenshots. None of your data is involved.`);
  const outcomes = await checkAll(fixtures);
  outcomes.forEach(printOutcome);
  const v = verdict(outcomes);
  console.log(
    `\n${v.safe ? "SAFE" : "NOT SAFE"}: ${
      v.safe
        ? "no wrong, invented or guessed rows."
        : "the model returned wrong, invented, or guessed rows. Don't trust it for import."
    }${v.safe && !v.complete ? " Some readable rows were left out." : ""}`,
  );
  return v.safe ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
