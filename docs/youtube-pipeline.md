# YouTube insights pipeline

End-to-end design for crawling YouTube videos and extracting Pokémon-investment
insights with an LLM. Built on branch `feat/youtube-pipeline`.

## Architecture

Two halves, one database. The Next.js app and the Python pipeline never call
each other — they communicate only via tables in the shared Postgres.

```
┌──────────────────────────────┐                ┌──────────────────────────┐                ┌──────────────────┐
│ pipeline/  (Python, uv)      │   writes ─▶    │  Postgres (shared)       │   ◀─ reads     │ Next.js app      │
│  • RSS-based discovery       │                │  prompts                 │                │  • /sources CRUD │
│  • youtube-transcript-api    │   reads  ─▶    │  youtube_sources         │   writes ─▶    │  • /admin/prompts│
│  • OpenAI extraction         │                │  youtube_videos          │                │  • /insights     │
│  • CLI: discover | …         │                │  youtube_transcripts     │                │  (no AI code)    │
└──────────────────────────────┘                │  youtube_insights        │                └──────────────────┘
       ▲                                        │  youtube_insight_mentions│
       │ schedules                              │  items, transactions…    │
       │                                        └──────────────────────────┘
┌──────┴───────────────────────┐
│ Argo CronWorkflows (k8s)     │
│  • discover    @ hourly      │
│  • transcripts @ */15min     │
│  • insights    @ */30min     │
└──────────────────────────────┘
```

### Why two halves?

- **Decouples release cadence.** Tweaks to the extraction prompt or model
  don't require redeploying the app, and vice versa.
- **Different runtimes for different jobs.** `youtube-transcript-api` is a
  mature Python library; OpenAI's Python SDK has first-class structured
  outputs. The Next.js app stays focused on product UX.
- **Smaller blast radius.** A flaky scraper or LLM rate limit can't bring
  down the user-facing app.

### Schema ownership

Drizzle (in `src/db/schema.ts`) owns **all** migrations. Python reads/writes
the same tables via raw SQL (`psycopg`). Avoids two migration tools, avoids
schema drift. When you add a column, add it to `schema.ts`, run
`npm run db:generate && npm run db:migrate`, and the Python code can use it
on the next run.

## Tables

All defined in [`src/db/schema.ts`](../src/db/schema.ts). Migration:
[`drizzle/0001_oval_lila_cheney.sql`](../drizzle/0001_oval_lila_cheney.sql).

### `prompts`

User-editable, versioned LLM prompts.

| column            | notes                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `id`              | uuid PK                                                          |
| `name`            | groups versions (e.g. `youtube_insight_extraction`)              |
| `version`         | int; bumped on every save                                        |
| `model`           | e.g. `gpt-4o-mini`                                               |
| `temperature`     | nullable — some models reject the param                          |
| `system_text`     | system message                                                   |
| `user_template`   | mustache-style, with `{{title}}`, `{{transcript}}` placeholders  |
| `response_schema` | jsonb — JSON Schema enforced by OpenAI structured outputs        |
| `is_active`       | bool; partial unique index `(name) WHERE is_active` keeps one    |
| `created_at`      | timestamptz                                                      |
| `created_by`      | nullable, display-only                                           |

**Append-only.** Saving in the UI inserts a new row with `version + 1` and
flips `is_active` to it. Old rows stay. The exact prompt used for each
insight is preserved via `youtube_insights.prompt_id`.

### `youtube_sources`

User-curated list of channels/videos to crawl.

| column               | notes                                                  |
| -------------------- | ------------------------------------------------------ |
| `kind`               | enum `channel` \| `video`                              |
| `external_id`        | `UC…` for channel, 11-char ID for video                |
| `active`             | false hides from crawling but keeps history            |
| `last_discovered_at` | bumped on each discover run                            |

Unique on `(kind, external_id)`.

### `youtube_videos`

One row per discovered video. PK is the YouTube `video_id`.
`source_id` is `ON DELETE SET NULL` — deleting a source preserves history.

### `youtube_transcripts`

1:1 with `youtube_videos` (PK = `video_id`).

- `status = 'ok'`     → `text` and `segments` are populated
- `status = 'missing'` → captions disabled on YouTube; row exists so we
  don't keep retrying
- `status = 'error'`  → `error_msg` has the failure reason

`segments` keeps the timestamped lines exactly as returned by
`youtube-transcript-api` for citation in the UI.

### `youtube_insights`

One row per `(video, prompt)` pair (enforced by
`youtube_insights_video_prompt_uq`). Re-running the same prompt is an upsert;
running a *new* prompt version writes a new row, so A/B comparison is free.

`prompt_id` is `ON DELETE RESTRICT` — we never want an insight orphaned from
the wording that produced it. (Prompts are append-only anyway.)

`payload` is the full validated JSON. `youtube_insight_mentions` is a
denormalized projection — see below.

### `youtube_insight_mentions`

Flattened mentions for analytics. One row per `(insight, mention)`.

`item_id` is best-effort: the matcher links to `items.id` when the rawName
matches confidently, otherwise leaves it null. The `/admin` UI exposes an
"unmatched mentions" resolver where a human picks (or creates) the right
item. `ON DELETE SET NULL` on `item_id` keeps the mention alive when items
are deleted.

## Pipeline phases

Each phase is idempotent — re-running is free and only does the work that's
missing. The Argo schedule mirrors this: each phase has its own
`CronWorkflow` so failures and concurrency are isolated.

### 1. `discover`

For each `youtube_sources.active = true` row of kind `channel`:

- fetch `https://www.youtube.com/feeds/videos.xml?channel_id={external_id}`
- upsert each entry into `youtube_videos` keyed by `video_id`
- update `last_discovered_at`

No API key needed. RSS returns ~15 latest per channel. If you need backfill,
add a one-shot via the YouTube Data API (separate, optional).

### 2. `transcripts`

Selects `youtube_videos` with no row in `youtube_transcripts`. For each:

- call `youtube_transcript_api`
- on success → insert row with `status='ok'`, full text, segments
- on `TranscriptsDisabled` → insert row with `status='missing'`
- on any other exception → insert row with `status='error'`, `error_msg`

Records the failure either way so the next run skips the video.

### 3. `insights`

Selects `youtube_transcripts.status = 'ok'` rows that don't yet have an
insight for the currently-active prompt:

```sql
SELECT t.video_id, t.text, v.title
FROM youtube_transcripts t
JOIN youtube_videos v ON v.video_id = t.video_id
LEFT JOIN youtube_insights i
  ON i.video_id = t.video_id AND i.prompt_id = :active_prompt_id
WHERE t.status = 'ok' AND i.id IS NULL
```

For each: render `user_template`, call OpenAI with `response_format` =
the prompt's `response_schema`, write `youtube_insights` + flatten mentions
into `youtube_insight_mentions`, fuzzy-match each `raw_name` against
`items.name`.

## Triggering

| Where     | How                                                            |
| --------- | -------------------------------------------------------------- |
| Local dev | `cd pipeline && uv run poke-pipeline {discover\|transcripts\|insights\|all}` |
| Prod      | Argo `CronWorkflow` resources in `pipeline/deploy/argo/`        |

No HTTP endpoints. The Next.js app has no buttons that trigger crawling — if
you want to force a run, hit the CLI or `argo submit --from cwf/…`.

## Configuration

Both halves read the same env vars:

| var               | used by         | purpose                            |
| ----------------- | --------------- | ---------------------------------- |
| `DATABASE_URL`    | both            | Postgres connection                |
| `OPENAI_API_KEY`  | pipeline        | LLM extraction                     |

In k8s, both are mounted from a `Secret` (see
`pipeline/deploy/argo/secret.example.yaml`).

## Local dev workflow

1. `npm run setup` — boots Postgres, runs migrations
2. Add a source via the `/sources` page (or insert directly for testing)
3. `cd pipeline && uv run poke-pipeline all`
4. View results at `/insights`
