# Poke Investor

Simple profit tracker for Pokemon card inventory. Log buy and sell
transactions; the app tracks holdings, moving-average cost, and realized /
unrealized profit. Designed to grow into live-price tracking via TCGPlayer /
eBay later.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind v4
- Postgres 16 (via Docker)
- Drizzle ORM + Drizzle Kit (migrations)
- Zod (input validation)
- Vitest (unit tests for business logic)

## Prerequisites

- Node.js 20+
- Docker Desktop (Windows: enable WSL 2 during install)

## First-time setup

Make sure **Docker Desktop is running** (Windows: install with WSL 2 enabled;
macOS: launch the Docker Desktop app and wait for the whale icon to settle).
Then, in the project directory:

```bash
npm install
npm run setup       # creates .env, starts Postgres, runs migrations
npm run dev
```

Open <http://localhost:3000>.

For a clean demo with sample Charizard / Pikachu data, use
`npm run setup:fresh` instead of `npm run setup`.

## Day-to-day

| Command | What it does |
| --- | --- |
| `npm run setup` | One-shot: create `.env`, start Postgres, run migrations |
| `npm run setup:fresh` | `setup` + wipe & reseed with demo data |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm test` | Run Vitest unit tests |
| `npm run db:generate` | Generate a new SQL migration from `schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Wipe & reseed with demo data |
| `npm run db:studio` | Browse the DB in Drizzle Studio |
| `docker compose up -d` | Start Postgres |
| `docker compose down` | Stop Postgres (data persists in volume) |

## Project layout

```
src/
  app/                    Next.js routes (App Router)
    page.tsx              Dashboard
    items/                Item list, detail, new
    transactions/new/     Add transaction form
    sources/              YouTube source CRUD
    insights/             LLM-extracted insights view
    admin/                Bulk actions, prompt editor, unmatched mentions
    api/export/           CSV export
  components/             Reusable UI (Button, Card, Money, etc.)
  db/
    schema.ts             Drizzle schema (items, transactions, youtube_*, prompts)
    client.ts             DB connection
    migrate.ts, seed.ts   CLI scripts
  lib/
    money.ts              Cents <-> dollars helpers
    calc/holdings.ts      Moving-average + holdings replay (pure)
    calc/portfolio.ts     Cross-item aggregation
    server/               Server actions (items, transactions, prices,
                          youtube, prompts, insights)
    youtube/              Pure YouTube URL/handle parser (+ tests)
pipeline/                 Python pipeline — see pipeline/README.md
drizzle/                  Generated SQL migrations
docs/                     Architecture docs (e.g. youtube-pipeline.md)
docker-compose.yml        Postgres service
```

## YouTube insights pipeline

A separate Python service crawls YouTube channels in the user's source list,
fetches transcripts, and runs LLM extraction to surface card / sealed-product
mentions and price calls. The pipeline reads and writes Postgres but never
touches the Next.js code — see [`docs/youtube-pipeline.md`](docs/youtube-pipeline.md)
for the architecture and [`pipeline/README.md`](pipeline/README.md) for setup.

Quickstart:

```bash
brew install uv
cd pipeline && uv sync
# Add a source via /sources in the web UI, then:
uv run poke-pipeline all
```

Prompts used for extraction are editable from `/admin/prompts` — saving
creates a new version and flips the pipeline to it without a redeploy.

## Money handling

All amounts are stored as **integer minor units of the row's currency** in the
DB to avoid floating-point errors. For 2-decimal currencies (USD, EUR) that's
cents; for 0-decimal currencies (VND, JPY, KRW) it's the whole unit. Convert at
the edges: input strings → minor units via `parseAmount(input, currency)`;
display with `<Money amount={...} currency={...} />`.

## Currencies

Each transaction and market price is tagged with an ISO 4217 currency. All
transactions of one item must share a currency (enforced at the calc layer).
The dashboard converts everything to a chosen **display currency** (default
VND) using today's spot FX rate from
[open.er-api.com](https://open.er-api.com) (free, no key, supports VND).
Rates are cached for 12h in the `fx_rates` table; a stale cached rate is
preferred to a hard failure if the API is unreachable.

Change the display currency at `/settings`.

## Calculation model

Moving-average cost (intentionally simpler than FIFO):

- **Buy:** `newAvg = (heldQty * avg + buyValue) / (heldQty + buyQty)`
- **Sell:** `realized += sellValue - sellQty * avg`; `avg` unchanged
- **Reset:** when held quantity hits 0, `avg` resets on the next buy

Holdings are computed by **replaying transactions chronologically** from the DB
on every read. This means edits and out-of-order entries are handled correctly
without storing redundant snapshots.

## PriceCharting integration

Per-item live price refresh is wired up. To enable:

1. Buy a [PriceCharting API token](https://www.pricecharting.com/api-documentation)
   and paste it on the **Settings** page.
2. On any item, set its **PriceCharting product ID** (numeric ID from a
   PriceCharting product page).
3. From the item detail page, click **Refresh from PriceCharting**.

The fetched USD price is automatically converted to the item's tracking
currency via the live FX rate, then stored as a `market_prices` row with
`source = 'pricecharting'`. The audit trail keeps the source so you can tell
manual entries from API-refreshed ones.

If you want to add a daily background worker that refreshes every item, the
server action `refreshPriceFromPriceCharting(itemId)` is the entry point —
wrap it in a cron job or schedule.

## Future direction (not yet built)

- Daily background worker calling `refreshPriceFromPriceCharting` for every
  item with a PriceCharting ID.
- Price history charts (the `market_prices` table is a time series — already
  has the data).
- TCGPlayer official API integration (Pro Seller account required).
- Card catalog auto-complete (e.g. pokemontcg.io).
- CSV import to migrate from spreadsheets.
