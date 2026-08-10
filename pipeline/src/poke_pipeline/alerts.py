"""Webhook alerts for newly-extracted insight mentions.

Fires when a mention links to a *held* item (any prior buy transaction).
Kept intentionally simple: one HTTP POST per insight, all held-item
mentions in a single message. Compatible with Slack, Discord, and any
generic JSON webhook that accepts `text` / `content` keys.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from psycopg import Connection

log = logging.getLogger(__name__)


def _held_item_ids(conn: Connection[Any], item_ids: list[str]) -> set[str]:
    """Filter to items that have any prior buy transaction."""
    if not item_ids:
        return set()
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT item_id::text
            FROM transactions
            WHERE item_id = ANY(%s::uuid[])
              AND type = 'buy'
            """,
            (item_ids,),
        )
        return {row["item_id"] for row in cur.fetchall()}


def _item_names(conn: Connection[Any], item_ids: list[str]) -> dict[str, str]:
    if not item_ids:
        return {}
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id::text AS id, name FROM items WHERE id = ANY(%s::uuid[])",
            (item_ids,),
        )
        return {row["id"]: row["name"] for row in cur.fetchall()}


def send_mention_alerts(
    conn: Connection[Any],
    *,
    webhook_url: str | None,
    video_id: str,
    video_title: str,
    channel_title: str | None,
    mentions: list[dict[str, Any]],
) -> None:
    """Fire-and-forget webhook post for held-item mentions.

    `mentions` shape: [{"item_id": str|None, "raw_name": str,
                        "sentiment": "bullish"|"neutral"|"bearish",
                        "quote": str|None}]

    Silently no-ops when `webhook_url` is falsy or no mention links to a
    held item. Errors are logged but never raised — a broken webhook
    should not fail the pipeline.
    """
    if not webhook_url:
        return

    linked_ids = [m["item_id"] for m in mentions if m.get("item_id")]
    if not linked_ids:
        return

    try:
        held = _held_item_ids(conn, linked_ids)
    except Exception:  # pragma: no cover — defensive
        log.exception("alerts: held-item lookup failed")
        return
    if not held:
        return

    names = _item_names(conn, list(held))
    relevant = [m for m in mentions if m.get("item_id") in held]

    lines = [
        f"🎥 *{video_title}*"
        + (f" — {channel_title}" if channel_title else ""),
        f"https://www.youtube.com/watch?v={video_id}",
        "",
    ]
    for m in relevant:
        item_name = names.get(m["item_id"], m.get("raw_name", "?"))
        emoji = {
            "bullish": "🟢",
            "bearish": "🔴",
            "neutral": "⚪",
        }.get(m.get("sentiment", "neutral"), "⚪")
        line = f"{emoji} *{item_name}* ({m.get('sentiment', 'neutral')})"
        quote = m.get("quote")
        if quote:
            line += f"\n   > {quote[:200]}"
        lines.append(line)

    text = "\n".join(lines)
    payload = {"text": text, "content": text}  # slack + discord compat

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(webhook_url, json=payload)
            r.raise_for_status()
        log.info(
            "alerts: posted %d held-item mention(s) for video %s",
            len(relevant),
            video_id,
        )
    except Exception as e:  # pragma: no cover — defensive
        log.warning("alerts: webhook POST failed for video %s: %s", video_id, e)
