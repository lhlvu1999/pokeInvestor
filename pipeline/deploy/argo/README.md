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
