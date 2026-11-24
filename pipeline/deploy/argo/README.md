# Argo deployment

Schedules the Python pipeline as three independent `CronWorkflow` resources.
Each phase has its own schedule so a slow `insights` run doesn't delay
`discover`.

## Files

| File                                    | What it is                                                |
| --------------------------------------- | --------------------------------------------------------- |
| `workflowtemplate.yaml`                 | Parameterized template — image + env + retry policy       |
| `cronworkflow-backfill.yaml`            | every 30 min — processes newly-added sources              |
| `cronworkflow-discover.yaml`            | hourly                                                    |
| `cronworkflow-transcripts.yaml`         | every 15 min                                              |
| `cronworkflow-insights.yaml`            | every 30 min                                              |
| `cronworkflow-refresh-prices.yaml`      | daily 01:00 UTC — asks the web app to refresh market prices for what you hold (before the alerts) |
| `cronworkflow-watchlist-alerts.yaml`    | daily 02:00 UTC — buy-target, sell-target and opt-in "usual low point" alerts via webhook |
| `cronworkflow-weekly-digest.yaml`       | Mondays 02:00 UTC — one weekly summary message via webhook (read-only) |
| `cronworkflow-catalog-sync.yaml`        | daily 21:00 UTC — Pokémon sets, sealed prices, set totals; links held items |
| `secret.example.yaml`                   | Template — never commit a populated copy                  |

## Prerequisites

- Argo Workflows installed in the target namespace
- A `ServiceAccount` named `argo-workflow` (or edit
  `workflowtemplate.yaml#spec.serviceAccountName`)
- The pipeline image pushed to a registry the cluster can pull from. The
  template currently references `ghcr.io/your-org/poke-pipeline:latest` —
  update before applying.

## Build & push the image

From `pipeline/`:

```bash
docker buildx build \
  --platform linux/amd64 \
  --tag ghcr.io/your-org/poke-pipeline:$(git rev-parse --short HEAD) \
  --tag ghcr.io/your-org/poke-pipeline:latest \
  --push \
  .
```

## Apply

```bash
# Create the secret first (don't apply secret.example.yaml directly).
kubectl create secret generic poke-pipeline \
  --from-literal=DATABASE_URL="postgres://…" \
  --from-literal=OPENAI_API_KEY="sk-…"

# Apply the template, then the schedules.
kubectl apply -f workflowtemplate.yaml
kubectl apply -f cronworkflow-backfill.yaml
kubectl apply -f cronworkflow-discover.yaml
kubectl apply -f cronworkflow-transcripts.yaml
kubectl apply -f cronworkflow-insights.yaml
kubectl apply -f cronworkflow-refresh-prices.yaml
kubectl apply -f cronworkflow-watchlist-alerts.yaml
kubectl apply -f cronworkflow-weekly-digest.yaml
kubectl apply -f cronworkflow-catalog-sync.yaml
```

## Trigger manually

```bash
# Run any phase right now (skip the schedule).
argo submit --from workflowtemplate/poke-pipeline -p phase=insights

# Or trigger a CronWorkflow's underlying template:
argo cron get poke-pipeline-discover
argo submit --from cronwf/poke-pipeline-discover
```

## Resource sizing

Defaults in `workflowtemplate.yaml`:

| Phase        | Typical runtime         | Why                                  |
| ------------ | ----------------------- | ------------------------------------ |
| backfill     | <2s per new source      | One flat HTTP per channel; bounded by `backfill_max_videos`. Skips already-backfilled sources. |
| discover     | seconds                 | RSS fetch per channel, cheap         |
| transcripts  | ~1s/video               | Network-bound on YouTube responses   |
| insights     | seconds–minutes/video   | LLM call dominates; budget for cost  |
| watchlist-alerts | seconds             | A few SQL queries plus at most three webhook POSTs (buy targets, the opt-in "usual low point" alerts which fire once per product, and sell targets for items you hold) |
| refresh-prices | under a minute | One authenticated call to the web app, which then makes ~1 eBay request per held item (about 130 for your portfolio, well inside eBay's 5,000 a day). It needs `APP_URL` and `CRON_TOKEN` in the secret; see the main README. |
| weekly-digest | seconds             | A few SQL reads and one webhook POST a week. Read-only: it never writes to the database. |
| catalog-sync | ~10s a day; ~10 min the first time | One 4 MB archive file a day. The first run also reads ~690 set product lists, 0.25s apart, from a hobby-run site, so keep it polite and don't schedule it more often than daily. It then links the items you hold to their catalogue product when there is one clear, price-checked match, fills missing images, matches graded slabs to their catalogue card and keeps that card's raw price; it never overrides a link, skip or unlink you made. |
| catalog-backfill (manual) | ~50 min, once | Loads price history from the daily archive, one ~4 MB file at a time with a pause between. Not scheduled: run it once by hand (`uv run poke-pipeline catalog-backfill`). It skips days already stored, so it can be stopped and resumed. |

If insights runs frequently exceed memory, raise the `limits.memory` — the
extractor holds one transcript in RAM at a time but token counts vary.

## Concurrency

`concurrencyPolicy: Forbid` on every CronWorkflow prevents a slow run from
stampeding the next scheduled execution. Combined with each phase's
idempotent design (upserts, "skip if already done" SELECTs), missed runs
recover automatically on the next tick.

## Observability

`argo logs <workflow-name>` for stderr from the CLI (the pipeline logs to
stderr via Python's logging). Use Argo's archive feature for long-term
retention; the WorkflowTemplate already sets `ttlStrategy` to purge succeeded
pods after a day and keep failures for a week.
