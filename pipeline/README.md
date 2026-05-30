# pipeline

YouTube transcript + LLM extraction for the Pokémon investor app. Reads the
same Postgres the Next.js app uses (`youtube_sources`, `prompts`) and writes
back `youtube_videos`, `youtube_transcripts`, `youtube_insights`,
`youtube_insight_mentions`. Never imports from the Next.js code.

For the full architecture see [`../docs/youtube-pipeline.md`](../docs/youtube-pipeline.md).

## Quickstart (local)

1. Install `uv` (one-time): `brew install uv`
2. From the repo root: `cd pipeline && uv sync`
3. Make sure the DB is up: `docker compose up -d` (run from repo root)
4. Add a source in the Next.js `/sources` page
5. Run the full pipeline:
   ```bash
   uv run poke-pipeline all
   ```

## Subcommands

```bash
uv run poke-pipeline backfill     # one-shot deep fetch for newly-added sources
uv run poke-pipeline discover     # RSS-based video discovery (hourly)
uv run poke-pipeline transcripts  # youtube-transcript-api fetch
uv run poke-pipeline insights     # OpenAI structured-output extraction
uv run poke-pipeline all          # backfill → discover → transcripts → insights
uv run poke-pipeline -v all       # verbose logging
```

Each phase is idempotent — re-running only does the work that's missing.

## Configuration

Reads `../.env` (repo root) so secrets are shared with the Next.js app:

| var                    | required for     | default | notes                                     |
| ---------------------- | ---------------- | ------- | ----------------------------------------- |
| `DATABASE_URL`         | all phases       | —       |                                           |
| `OPENAI_API_KEY`       | insights         | —       | Any non-empty string for local backends   |
| `OPENAI_BASE_URL`      | insights         | unset   | e.g. `http://localhost:11434/v1` (Ollama) |
| `PIPE_LLM_JSON_MODE`   | insights         | auto    | Auto-on when `OPENAI_BASE_URL` is local   |
| `LLM_MODEL`            | insights         | unset   | Overrides `prompts.model` for this run    |
| `LLM_TEMPERATURE`      | insights         | unset   | Number, or `null` to omit (o-series)      |
| `PIPE_DISCOVER_MAX`    | discover         | 50      |                                           |
| `PIPE_INSIGHTS_BATCH`  | insights         | 25      |                                           |
| `PIPE_HTTP_TIMEOUT_SEC`| discover/scrape  | 30      |                                           |

### Where does the model name come from?

By default it's the `model` column on the **active prompt row** in the DB —
visible and editable at `/admin/prompts`. That's the right home for it in
production: the prompt and the model that produced it are versioned together,
so every `youtube_insights` row can be traced back to the exact
prompt-and-model that wrote it.

For per-environment overrides (dev vs prod, OpenAI vs Ollama) set `LLM_MODEL`
in `.env` — it wins over the prompt's value at run time *for that process
only*. The DB row is untouched. `LLM_TEMPERATURE` works the same way.

The startup log line for every run tells you what's in effect:

```
INFO  poke_pipeline.extract · insights: 5 transcript(s) for prompt
youtube_insight_extraction v2 · model=qwen2.5:7b [env] temp=0.1 [env]
· backend=http://localhost:11434/v1 json_mode=True
```

The `[env]` / `[prompt]` tag after each value says whose value won.

### Running insights against a local model (Ollama)

Use this when you don't want to spend OpenAI credits during dev, or when
your OpenAI key is unavailable. Ollama exposes an OpenAI-compatible API at
`http://localhost:11434/v1`, so the pipeline talks to it with the same code
path — just a different base URL.

**One-time setup:**

```bash
brew install ollama
brew services start ollama          # runs in background; survives reboots
ollama pull qwen2.5:7b              # ~4.7 GB; best small open model at JSON
# Optional bigger / smaller:
# ollama pull llama3.1:8b           # ~4.7 GB
# ollama pull qwen2.5:14b           # ~9 GB, needs 16 GB+ RAM
```

**Point the pipeline at it.** In repo-root `.env`:

```env
OPENAI_API_KEY=ollama                       # any non-empty string
OPENAI_BASE_URL=http://localhost:11434/v1
LLM_MODEL=qwen2.5:7b                        # overrides the prompt's model for this env
# PIPE_LLM_JSON_MODE=1                      # auto-enabled by base URL
```

`LLM_MODEL` overrides whatever `model` is stored on the active prompt row
in the DB, so you don't have to edit the prompt to switch between OpenAI
and Ollama. The prompt stays the same; the env decides which model runs
it. See *Where does the model name come from?* below.

**Run it:**

```bash
uv run poke-pipeline insights
```

You should see a startup line like:

```
INFO  poke_pipeline.extract · insights: N transcript(s) pending for prompt
youtube_insight_extraction v2 via http://localhost:11434/v1 (json_mode=True)
```

**Caveats with local models:**

- **Slower than OpenAI.** A 7B model on Apple Silicon does ~30–60 tok/s; an
  8k-token transcript can take 30–90s per video. Lower `PIPE_INSIGHTS_BATCH`
  if a single run is too long.
- **No strict schema enforcement.** Ollama's OpenAI shim supports `json_object`
  mode (we use it automatically) but not OpenAI's `strict: true`. The model
  *usually* returns the right shape because the system prompt describes it,
  but occasional malformed JSON gets logged as an error on that video. The
  next run retries unaffected videos.
- **Transcript length.** Default Ollama context is 2048 tokens — too small
  for most full transcripts. Set a larger context in the model's `Modelfile`
  or via `OLLAMA_CONTEXT_LENGTH=8192 ollama serve`. Without this, long
  transcripts will be silently truncated.

### Title freshness for backfilled videos

`backfill` uses yt-dlp's flat channel extraction, which returns YouTube's
*cached* channel-listing data — sometimes a few hours behind the watch page.
If a creator renames a video after upload, the flat title can be stale.

The pipeline handles this with a strict precedence rule: **RSS always wins
over backfill for the `title` column**. The upsert in `discover.upsert_video`
will not overwrite an RSS-set title with a flat-extract one. In practice:

- **Latest ~15 videos per channel** — refreshed hourly by `discover`. Always
  match YouTube exactly, even through renames.
- **Older backfilled videos** — title is whatever flat extract returned at
  backfill time. Almost always correct; very occasionally drifts if the
  creator renamed an older video. Acceptable trade-off for a count-based
  backfill that needs no API key and no auth.

If a particular older video's title looks wrong, the quickest fix is to
re-run backfill on that source (clear `backfilled_at` in the DB, or via the
forthcoming "Re-backfill" button) — yt-dlp's channel-page cache usually
catches up within a day.

### Switching back to OpenAI

Just clear `OPENAI_BASE_URL` (or comment it out) and put your real
`sk-…` key in `OPENAI_API_KEY`. Strict structured outputs come back on
automatically.

## Layout

```
src/poke_pipeline/
  cli.py          # typer CLI (poke-pipeline …)
  config.py       # env loading
  db.py           # psycopg pool + connection() helper
  sources.py      # read-only access to youtube_sources
  prompts.py      # read active prompt from DB
  discover.py     # phase 1: RSS + watch-page scrape
  transcripts.py  # phase 2: youtube-transcript-api wrapper
  matching.py     # rapidfuzz item matcher
  extract.py      # phase 3: OpenAI structured outputs
tests/
deploy/argo/      # CronWorkflow manifests
Dockerfile        # added later — for in-cluster runs
```

## Testing

```bash
uv run pytest          # unit tests (no DB needed)
uv run mypy src        # static types
uv run ruff check src  # lint
uv run ruff format src # auto-format
```

## Production (Argo Workflows)

Each phase has its own `CronWorkflow` resource under
[`deploy/argo/`](deploy/argo/). See the file headers there for the
expected `Secret` shape.

| phase       | schedule          | cron            |
| ----------- | ----------------- | --------------- |
| discover    | hourly            | `0 * * * *`     |
| transcripts | every 15 minutes  | `*/15 * * * *`  |
| insights    | every 30 minutes  | `*/30 * * * *`  |

`concurrencyPolicy: Forbid` on each so a slow run can't stampede.
