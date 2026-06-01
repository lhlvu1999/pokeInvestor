"""Phase 3 — LLM extraction.

For every `ok` transcript without an insight for the currently-active
prompt, render the user template, call OpenAI with structured outputs,
validate the JSON, write an `youtube_insights` row, and flatten the
mentions into `youtube_insight_mentions` with best-effort matching to
the existing `items` table.

Idempotent on `(video_id, prompt_id)` — re-running the same prompt does
nothing. Editing the prompt in the admin UI bumps the active prompt's
id, which causes the next run to re-extract the same transcripts with
the new wording. Old rows are preserved for A/B comparison.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass
from typing import Any

from openai import OpenAI, OpenAIError

from poke_pipeline.config import load_settings
from poke_pipeline.db import connection
from poke_pipeline.llm_io import (
    LLMResponseError,
    build_schema_instruction,
    parse_llm_json,
)
from poke_pipeline.matching import ItemRef, load_items_index, match_item
from poke_pipeline.prompts import ActivePrompt, get_active_prompt, render_user_template

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ExtractResult:
    processed: int
    skipped: int
    errored: int


def run() -> ExtractResult:
    settings = load_settings()
    if not settings.openai_api_key:
        log.warning("OPENAI_API_KEY not set — skipping insights phase")
        return ExtractResult(processed=0, skipped=0, errored=0)

    prompt = get_active_prompt()
    if prompt is None:
        log.error("no active prompt — seed one from the admin UI first")
        return ExtractResult(processed=0, skipped=0, errored=0)

    pending = _select_pending(prompt.id, limit=settings.insights_batch_limit)
    if not pending:
        log.info("insights: nothing to do")
        return ExtractResult(processed=0, skipped=0, errored=0)

    # Resolve effective model + temperature once per run so the log message
    # tells the operator exactly what's going to be sent.
    effective_model = settings.llm_model_override or prompt.model
    if settings.llm_temperature_force_null:
        effective_temperature: float | None = None
    elif settings.llm_temperature_override is not None:
        effective_temperature = settings.llm_temperature_override
    else:
        effective_temperature = prompt.temperature

    model_src = "env" if settings.llm_model_override else "prompt"
    temp_src = (
        "env"
        if (
            settings.llm_temperature_force_null
            or settings.llm_temperature_override is not None
        )
        else "prompt"
    )

    log.info(
        "insights: %d transcript(s) for prompt %s v%d · model=%s [%s] "
        "temp=%s [%s] · backend=%s json_mode=%s · timeout=%.0fs",
        len(pending),
        prompt.name,
        prompt.version,
        effective_model,
        model_src,
        effective_temperature,
        temp_src,
        settings.openai_base_url or "api.openai.com",
        settings.llm_json_mode,
        settings.llm_timeout_sec,
    )

    client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
        timeout=settings.llm_timeout_sec,
    )
    items_index = load_items_index()

    processed = skipped = errored = 0
    for video_id, title, transcript_text in pending:
        if not transcript_text:
            skipped += 1
            continue
        try:
            payload, usage, latency_ms = _call_llm(
                client,
                prompt,
                title=title,
                transcript=transcript_text,
                json_mode=settings.llm_json_mode,
                model=effective_model,
                temperature=effective_temperature,
            )
        except OpenAIError as exc:
            log.warning("openai error on %s: %s", video_id, exc)
            errored += 1
            continue
        except LLMResponseError:
            # `_call_llm` already logged the snippet at WARNING.
            errored += 1
            continue
        except Exception:
            log.exception("unexpected extract failure on %s", video_id)
            errored += 1
            continue

        insight_id = _insert_insight(
            video_id=video_id,
            prompt_id=prompt.id,
            payload=payload,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            latency_ms=latency_ms,
        )
        if insight_id is None:
            # Lost a race with another worker — skip.
            skipped += 1
            continue

        _insert_mentions(insight_id, payload, items_index)
        processed += 1

    return ExtractResult(processed=processed, skipped=skipped, errored=errored)


# ─── DB queries ─────────────────────────────────────────────────────────────


def _select_pending(prompt_id: str, *, limit: int) -> list[tuple[str, str, str]]:
    """Returns `(video_id, title, transcript_text)` for transcripts that
    don't yet have an insight for the active prompt.
    """
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT t.video_id, v.title, t.text
            FROM youtube_transcripts t
            JOIN youtube_videos v ON v.video_id = t.video_id
            LEFT JOIN youtube_insights i
              ON i.video_id = t.video_id AND i.prompt_id = %s
            WHERE t.status = 'ok'
              AND t.text IS NOT NULL
              AND i.id IS NULL
            ORDER BY COALESCE(v.published_at, v.discovered_at) DESC
            LIMIT %s
            """,
            (prompt_id, limit),
        )
        return [(row["video_id"], row["title"], row["text"]) for row in cur.fetchall()]


def _insert_insight(
    *,
    video_id: str,
    prompt_id: str,
    payload: dict[str, Any],
    input_tokens: int | None,
    output_tokens: int | None,
    latency_ms: int,
) -> str | None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO youtube_insights
              (video_id, prompt_id, payload, input_tokens, output_tokens, latency_ms)
            VALUES (%s, %s, %s::jsonb, %s, %s, %s)
            ON CONFLICT (video_id, prompt_id) DO NOTHING
            RETURNING id::text AS id
            """,
            (
                video_id,
                prompt_id,
                json.dumps(payload),
                input_tokens,
                output_tokens,
                latency_ms,
            ),
        )
        row = cur.fetchone()
        return row["id"] if row else None


def _insert_mentions(
    insight_id: str,
    payload: dict[str, Any],
    items_index: list[ItemRef],
) -> None:
    mentions = payload.get("mentions")
    if not isinstance(mentions, list):
        return
    with connection() as conn, conn.cursor() as cur:
        for m in mentions:
            if not isinstance(m, dict):
                continue
            raw_name = (m.get("name") or "").strip()
            sentiment = m.get("sentiment") or "neutral"
            if not raw_name or sentiment not in {"bullish", "bearish", "neutral"}:
                continue
            item_id = match_item(raw_name, items_index)
            cur.execute(
                """
                INSERT INTO youtube_insight_mentions
                  (insight_id, item_id, raw_name, set_hint, product_type,
                   sentiment, confidence, timestamp_sec, quote)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    insight_id,
                    item_id,
                    raw_name,
                    m.get("set_hint"),
                    m.get("product_type"),
                    sentiment,
                    _coerce_float(m.get("confidence")),
                    _coerce_int(m.get("timestamp_sec")),
                    m.get("quote"),
                ),
            )


def _coerce_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ─── OpenAI call ────────────────────────────────────────────────────────────


def _call_llm(
    client: OpenAI,
    prompt: ActivePrompt,
    *,
    title: str,
    transcript: str,
    json_mode: bool,
    model: str,
    temperature: float | None,
) -> tuple[dict[str, Any], dict[str, int | None], int]:
    """`model` and `temperature` are resolved by the caller (env override
    takes precedence over the prompt row) — see `run()`.
    """
    user_msg = render_user_template(
        prompt.user_template, title=title, transcript=transcript
    )
    # Strict structured outputs are an OpenAI-specific feature. Local backends
    # (Ollama, LM Studio, llama.cpp server) implement the OpenAI Chat API but
    # only support the simpler `json_object` mode — which forces the response
    # to *be* JSON but not which JSON. In that case we inline a terse,
    # human-readable schema description in the system prompt so the model
    # actually knows what keys/types to produce.
    system_text = prompt.system_text
    if json_mode:
        response_format: dict[str, Any] = {"type": "json_object"}
        system_text = (
            f"{prompt.system_text}\n\n{build_schema_instruction(prompt.response_schema)}"
        )
    else:
        response_format = {
            "type": "json_schema",
            "json_schema": {
                "name": "youtube_insight_extraction",
                "strict": True,
                "schema": prompt.response_schema,
            },
        }
    kwargs: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_text},
            {"role": "user", "content": user_msg},
        ],
        "response_format": response_format,
    }
    if temperature is not None:
        kwargs["temperature"] = temperature

    started = time.monotonic()
    response = client.chat.completions.create(**kwargs)
    latency_ms = int((time.monotonic() - started) * 1000)

    content = response.choices[0].message.content or ""
    try:
        payload: dict[str, Any] = parse_llm_json(content)
    except LLMResponseError as err:
        # Local models occasionally drift past every recovery path. Log the
        # truncated raw response (captured on the exception) so the operator
        # can see what the model emitted without dumping a multi-KB blob.
        log.warning(
            "LLM returned unparseable JSON: %s. Raw (truncated): %s",
            err,
            err.raw,
        )
        raise

    usage = response.usage
    usage_dict: dict[str, int | None] = {
        "input_tokens": getattr(usage, "prompt_tokens", None) if usage else None,
        "output_tokens": getattr(usage, "completion_tokens", None) if usage else None,
    }
    return payload, usage_dict, latency_ms
