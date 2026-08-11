"""Webhook alerts for newly-extracted insight mentions.

Fires when a mention links to something the user cares about:

  - A *held* item (has any prior buy transaction) — the incumbent case.
  - A *watchlist* entry — items the user has said they want but doesn't
    own yet. Matched either by explicit `watchlist_items.item_id` or,
    for floating entries, fuzzy `lower(raw_name) = lower(w.name)`.

Kept intentionally simple: one HTTP POST per insight, held + watchlist
mentions in a single message with per-section headers so the operator
can tell them apart. Compatible with Slack, Discord, and any generic
JSON webhook that accepts `text` / `content` keys.
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


def _watchlist_matches(
    conn: Connection[Any],
    mentions: list[dict[str, Any]],
) -> dict[int, str]:
    """For each mention, return a mapping mention-index → watchlist entry
    display name IF the mention matches an *active* watchlist entry.

    Matching rules mirror the app's `listWatchlist` join:
      - If both the mention and a watchlist row have `item_id`, they must
        equal.
      - Otherwise, `lower(m.raw_name) = lower(w.name)` and the watchlist
        row has `item_id IS NULL` (floating entry).

    Only active watchlist entries (`hit_at IS NULL`) count.
    """
    if not mentions:
        return {}

    linked_ids = list({m["item_id"] for m in mentions if m.get("item_id")})
    raw_names_lower = list(
        {(m.get("raw_name") or "").lower() for m in mentions if m.get("raw_name")}
    )
    if not linked_ids and not raw_names_lower:
        return {}

    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              w.item_id::text AS item_id,
              w.name AS wl_name,
              lower(w.name) AS wl_name_lower
            FROM watchlist_items w
            WHERE w.hit_at IS NULL
              AND (
                (w.item_id IS NOT NULL AND w.item_id::text = ANY(%s::text[]))
                OR
                (w.item_id IS NULL AND lower(w.name) = ANY(%s::text[]))
              )
            """,
            (linked_ids, raw_names_lower),
        )
        rows = cur.fetchall()

    # Build lookup tables.
    by_item_id: dict[str, str] = {}
    by_name_lower: dict[str, str] = {}
    for r in rows:
        if r["item_id"]:
            by_item_id[r["item_id"]] = r["wl_name"]
        else:
            by_name_lower[r["wl_name_lower"]] = r["wl_name"]

    out: dict[int, str] = {}
    for i, m in enumerate(mentions):
        item_id = m.get("item_id")
        raw_name = (m.get("raw_name") or "").lower()
        if item_id and item_id in by_item_id:
            out[i] = by_item_id[item_id]
        elif raw_name in by_name_lower:
            out[i] = by_name_lower[raw_name]
    return out


def _format_mention_line(
    display_name: str, sentiment: str, quote: str | None
) -> str:
    emoji = {
        "bullish": "🟢",
        "bearish": "🔴",
        "neutral": "⚪",
    }.get(sentiment, "⚪")
    line = f"{emoji} *{display_name}* ({sentiment})"
    if quote:
        line += f"\n   > {quote[:200]}"
    return line


def send_mention_alerts(
    conn: Connection[Any],
    *,
    webhook_url: str | None,
    video_id: str,
    video_title: str,
    channel_title: str | None,
    mentions: list[dict[str, Any]],
) -> None:
    """Fire-and-forget webhook post for held-item AND watchlist mentions.

    `mentions` shape: [{"item_id": str|None, "raw_name": str,
                        "sentiment": "bullish"|"neutral"|"bearish",
                        "quote": str|None}]

    Silently no-ops when `webhook_url` is falsy or no mention matches
    anything the user follows. Errors are logged but never raised — a
    broken webhook should not fail the pipeline.
    """
    if not webhook_url:
        return

    linked_ids = [m["item_id"] for m in mentions if m.get("item_id")]

    # Held-item matches.
    try:
        held = _held_item_ids(conn, linked_ids) if linked_ids else set()
    except Exception:  # pragma: no cover — defensive
        log.exception("alerts: held-item lookup failed")
        held = set()

    # Watchlist matches.
    try:
        wl_matches = _watchlist_matches(conn, mentions)
    except Exception:  # pragma: no cover — defensive
        log.exception("alerts: watchlist lookup failed")
        wl_matches = {}

    if not held and not wl_matches:
        return

    names = _item_names(conn, list(held)) if held else {}

    held_lines: list[str] = []
    for m in mentions:
        item_id = m.get("item_id")
        if item_id and item_id in held:
            name = names.get(item_id, m.get("raw_name", "?"))
            held_lines.append(
                _format_mention_line(
                    name, m.get("sentiment", "neutral"), m.get("quote")
                )
            )

    wl_lines: list[str] = []
    for i, m in enumerate(mentions):
        if i in wl_matches and not (m.get("item_id") and m["item_id"] in held):
            # Don't double-report: an item that's on the watchlist AND
            # held (both flags set) already appeared in the held section.
            wl_lines.append(
                _format_mention_line(
                    wl_matches[i], m.get("sentiment", "neutral"), m.get("quote")
                )
            )

    lines = [
        f"🎥 *{video_title}*"
        + (f" — {channel_title}" if channel_title else ""),
        f"https://www.youtube.com/watch?v={video_id}",
    ]
    if held_lines:
        lines.append("")
        lines.append("*In your portfolio:*")
        lines.extend(held_lines)
    if wl_lines:
        lines.append("")
        lines.append("*On your watchlist:*")
        lines.extend(wl_lines)

    text = "\n".join(lines)
    payload = {"text": text, "content": text}  # slack + discord compat

    try:
        with httpx.Client(timeout=10.0) as client:
            r = client.post(webhook_url, json=payload)
            r.raise_for_status()
        log.info(
            "alerts: posted %d held + %d watchlist mention(s) for video %s",
            len(held_lines),
            len(wl_lines),
            video_id,
        )
    except Exception as e:  # pragma: no cover — defensive
        log.warning("alerts: webhook POST failed for video %s: %s", video_id, e)
