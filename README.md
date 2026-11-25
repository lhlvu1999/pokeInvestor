# Poke Investor

Profit tracker for Pokemon sealed products and graded cards. Log buys and
sells; the app tracks holdings, cost (first-in-first-out or average, your choice),
realized and unrealized profit, and values what you hold with live market prices.
Around that sit analytics, a card and set catalogue, alerts, backups and an
optional login.

What is in it, by area (the header shows the same grouping):

- **Stock:** dashboard, items (with pictures, tags, sell targets and price floors), watchlist,
  offer builder, share snapshot, history, stock count, import (CSV and screenshots).
- **Analytics:** returns and a comparison with the market, exposure, graded slabs
  against raw cards, a yearly sales report with a tax-friendly CSV, stock on any
  day, and set and market insights from the catalogue.
- **Catalogue:** English and Japanese sets with sealed and card prices and history
  (TCGCSV), set insights, a release calendar, linking your items to it.
  New items are linked as you add them: the New item form and the transaction
  picker suggest catalogue matches, and a clear match is linked automatically.
- **Pipeline** (separate Python service): YouTube insights, catalogue sync and
  linking, price alerts via webhook (buy targets, sell targets, price floors), and a
  weekly summary. See `pipeline/README.md`.
- **Settings and admin:** display currency, cost method, backup and restore,
  schema sync, bulk tools, and a **setup checklist** (`/settings/checklist`) of the
  few things only you can do (backup, unexplained ₫0 sales, unmatched slabs,
  pictures, price freshness, eBay keys, login), each checked against your data.

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
npm run setup       # creates .env, starts Postgres, migrates and brings the schema fully up to date
npm run dev
```

Open <http://localhost:3000>.

For a clean demo with sample Charizard / Pikachu data, use
`npm run setup:fresh` instead of `npm run setup`.

## Day-to-day

| Command | What it does |
| --- | --- |
| `npm run setup` | One-shot: create `.env`, start Postgres, migrate, and bring the schema fully up to date |
| `npm run setup:fresh` | `setup` + wipe & reseed with demo data |
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | Production build |
| `npm test` | Run Vitest unit tests |
| `npm run db:generate` | Generate a new SQL migration from `schema.ts` |
| `npm run db:migrate` | Apply pending migrations, then bring the schema fully up to date (the same idempotent statements as the admin page's "Sync schema") and verify it |
| `npm run check:schema` | List any table or column the code expects but the database lacks (read-only) |
| `npm run db:seed` | Wipe & reseed with demo data |
| `npm run db:studio` | Browse the DB in Drizzle Studio |
| `npm run db:reset` | **Erases all data**: drops the Postgres volume, recreates it, migrates |
| `npm run db:reset:demo` | `db:reset` followed by the demo seed |
| `npm run lint` / `npm run typecheck` | ESLint / the TypeScript compiler, on their own |
| `npm run test:watch` | Vitest in watch mode |
| `npm run check:vision` | Test your screenshot-import model on made-up screenshots (see `.env.example`) |
| `docker compose up -d` | Start Postgres |
| `docker compose down` | Stop Postgres (data persists in volume) |

Before you trust a change:

```bash
npm run check    # type-check, lint, all TypeScript tests, then the pipeline's tests and lint
npm run smoke    # with the app running: visits every page and download, read-only
                 # (set SMOKE_PASSWORD if you turned the login on)
```

## Access (optional login)

By default the app has no login, which is fine on your own computer. If it can
be reached by anyone else (a server, a shared network), set `APP_PASSWORD` in
`.env` and restart: every page, API call and action then needs a signed-in
session, and a **Sign out** button appears in the header. There is one password
and no accounts. See `.env.example` for the details, including
`APP_SESSION_SECRET` and why you want HTTPS.

- A password shorter than 8 characters keeps the app **locked** with an
  explanation, rather than quietly open.
- Wrong passwords are slowed down and limited per address.
- The pipeline talks to the database directly, so it is not affected. Anything
  of your own that calls the app's API (a script, `curl`) needs the session
  cookie, or should go through the login first.
- Without a password the app still refuses requests addressed to a public domain
  name, which is how a web page can attack a local app (DNS rebinding). It answers
  on `localhost`, your own network addresses and plain machine names; list any
  other name in `APP_ALLOWED_HOSTS`.
- Anything that changes data (restore, login, ask) refuses requests made by
  another website on your behalf, login or not.
- This is a gate for one person, not a multi-user system.

## Project layout

```
src/
  proxy.ts                The login gate and no-login host check
  app/                    Next.js routes (App Router)
    page.tsx              Dashboard
    items/                List, detail, new, tags and sets
    transactions/         Add and edit
    analytics/            Returns, vs market, exposure, slabs, yearly, stock
    catalog/              Sets, insights, calendar, compare, linking
    watchlist/ offer/ share/ history/ import/ stock-count/
    sources/ insights/ ask/   YouTube sources, extracted insights, chat
    settings/ admin/      Settings, backup/restore, bulk tools, schema sync
    login/                Sign-in page (when a password is set)
    api/                  CSV exports, backup, restore, auth, item pictures
  components/             Reusable UI (Nav, Money, ItemThumb, charts...)
  db/
    schema.ts             Drizzle schema
    sync_statements.ts    Idempotent statements that bring any database up to date
    migrate.ts, seed.ts   CLI scripts (migrate also applies the statements and checks them)
    schema_check.ts       Compares schema.ts with a real database
  lib/
    calc/                 Pure business logic with tests: holdings and replay,
                          cashflow, analytics, returns, exposure, slabs, stock,
                          tags, backup, auth, exchange rates, catalogue maths
    server/               Database loaders and server actions
    currency.ts, fx.ts, ebay.ts, pricecharting.ts, csv.ts, ...
scripts/                  smoke.ts, check-schema.ts, check-vision.ts,
                          gen-replay-vectors.ts
pipeline/                 Python pipeline: see pipeline/README.md
drizzle/                  The original SQL migrations (later changes are in
                          src/db/sync_statements.ts)
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

Reports about **past sales** (the yearly report) use the exchange rate of the day
instead: proceeds at the sale day's rate and each purchase's cost at its own
day's rate, from a free public dataset (daily from March 2024), fetched only for
days with a foreign-currency trade and kept in `fx_history`. A ledger kept in one
currency never makes that request.

## Calculation model

Cost is decided by the **cost method** you pick in `/settings` (default FIFO):

- **FIFO:** a sale that names a lot takes units from that lot; any other sale
  takes the oldest units first. Realized profit reflects the units that left.
- **Average:** every held unit costs the pool's running average; a sale removes
  units at that average.

Either way, a unit that leaves for nothing (a gift, a loss, a pack opened) is a
write-off equal to its cost, and units bought but not yet received are not stock.
A sale larger than what is held removes what there is and no more.

Holdings are computed by **replaying transactions chronologically** from the DB
on every read, so edits and out-of-order entries are handled without stored
snapshots. The pipeline has its own tested copy of the replay
(`pipeline/src/poke_pipeline/replay.py`), checked against the app's with shared
vectors.

## Where market prices come from

An item linked to a sealed product in the catalogue is priced from **TCGplayer's
market price**, which follows what the product recently sold for. It is converted
to the item's currency at today's rate. This happens on **Update all prices**, on
the scheduled refresh, when you link an item, and when you buy a linked item that
has no price yet. A catalogue price older than a week is ignored.

Everything the catalogue cannot price (graded slabs, single cards, unlinked items,
products with no recent price) falls back to the eBay estimate below. eBay shows
what sellers are **asking**, not what sold, so it is the second choice. Linked
items never use up eBay quota.

## eBay price estimates

Set `EBAY_APP_ID` and `EBAY_CERT_ID` (an eBay developer keyset; see
`.env.example`) to estimate an item's market price from active eBay listings.
These are what sellers are **asking**, not what items sold for, so the estimate
takes a low percentile of the genuine-product listings and should be read as
approximate resale value. The **Update prices** buttons on the Items page and an
item's page run it, and so can a daily schedule (below).

### Scheduled price refresh

The pipeline can ask the app to refresh prices every day, so the daily alerts and
the weekly summary judge fresh numbers instead of whatever you last clicked.

1. On the app, set `CRON_TOKEN` to a long random value (`openssl rand -hex 32`;
   at least 32 characters) and restart. Without it the endpoint does not exist.
2. Give the pipeline the same `CRON_TOKEN` and `APP_URL` (where the app is, as the
   pipeline sees it), then run `uv run poke-pipeline refresh-prices`, or schedule
   it: `pipeline/deploy/argo/cronworkflow-refresh-prices.yaml` runs it daily at
   01:00 UTC, an hour before the alerts.

It does what **Update all prices** does, for the items you hold: anything priced in
the last hour is skipped, a low-confidence estimate is reported but not saved, and
a repeat run costs almost nothing. It stops early (and the command fails, so your
scheduler shows it) if eBay keeps rejecting requests, and it never runs twice at
once. The command prints a one-line summary and lists the items that got no price.

The endpoint (`POST /api/cron/refresh-prices`, `Authorization: Bearer <token>`)
is the one thing reachable without a session when the login is on; the token is
its only key, wrong tokens are rate-limited, and anyone holding the token can do
nothing more than start a refresh. With the login **off**, the app must also
accept the scheduler's host name (`APP_ALLOWED_HOSTS`). Use https if the scheduler
reaches the app over a network you don't control.

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

## Not built yet

- **TCGplayer official API** integration (Pro Seller account required); today the
  catalogue uses the free TCGCSV mirror.
- **More than one user.** The optional login is a single shared password.
