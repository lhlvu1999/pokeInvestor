"""Link the items you currently hold to catalogue products, and fill images.

This is the daily-sync half of the web app's "Link items to the catalogue"
screen, and it MUST agree with it. `match_item` here is a line-for-line port
of `src/lib/calc/catalog_match.ts`; both are tested against the same vectors
(`tests/fixtures/match_vectors.json`), so a change to one that isn't made in
the other fails a test.

What the sync does, and the care it takes
-----------------------------------------
- Only items you HOLD right now (received units minus sold units > 0).
- Only when the match is `confident`: one clearly best sealed product, no
  near-tie, AND, if both prices are known, the catalogue price is within a
  factor of two of your own (a booster box matched to its case would be ten
  times off). Anything less certain is left for you to review on screen.
- Never overrides a person. The sync acts only on items whose
  `catalog_link_source` is NULL: not linked, not skipped, not unlinked by you.
  Whatever it links is marked 'auto' so it can be reviewed and undone.
- Fills a missing image from the catalogue for any linked item. An image you
  already have (from eBay, say) is never replaced.
"""

from __future__ import annotations

import logging
import re
import unicodedata
from dataclasses import dataclass
from typing import TYPE_CHECKING

from poke_pipeline.db import connection
from poke_pipeline.set_tags import tag_item_with_set

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping, Sequence

log = logging.getLogger(__name__)

# ── Matcher: port of src/lib/calc/catalog_match.ts ─────────────────────────

STOP = frozenset({"the", "a", "an", "of", "and", "pokemon", "tcg", "x", "jp"})
TYPE_WORDS = frozenset(
    {
        "display",
        "case",
        "half",
        "sleeved",
        "pack",
        "blister",
        "bundle",
        "tin",
        "box",
        "collection",
        "deck",
        "binder",
        "figure",
        "poster",
        "booster",
    }
)
CONFIDENT_SCORE = 0.85
PROBABLE_SCORE = 0.7
WEAK_SCORE = 0.5
TIE_MARGIN = 0.03

# JavaScript's \b and \d are ASCII-only; match that exactly.
_A = re.ASCII
_ETB = re.compile(r"\betb\b", _A)
_BLISTER = re.compile(r"(\d)\s*blister\b", _A)
_PACKS = re.compile(r"\b\d+\s*packs?\b(?!\s*blister)", _A)
_NONWORD = re.compile(r"[^a-z0-9]+")
_COMBINING = re.compile("[̀-ͯ]")
# "tag" is also an ordinary word ("Tag Team Collection"): it only marks a slab
# when a grade follows it ("tag 10 ...").
_SLAB_START = re.compile(r"^((slab|psa|bgs|cgc)\b|tag\s*\d)", _A)
_SLAB_GRADE = re.compile(r"\b(psa|bgs|cgc)\s*\d", _A)


def tokens(name: str) -> list[str]:
    s = unicodedata.normalize("NFKD", name.lower())
    s = _COMBINING.sub("", s)
    s = s.replace("&", " and ")
    s = _ETB.sub("elite trainer box", s)
    s = _BLISTER.sub(r"\1 pack blister", s)
    s = _PACKS.sub(" ", s)
    s = _NONWORD.sub(" ", s)
    return [w for w in s.split(" ") if w and w not in STOP]


def is_sealed_candidate(name: str, tags: Iterable[str]) -> bool:
    """Slabs and single cards or promos have no sealed product to match."""
    n = name.lower()
    if _SLAB_START.search(n) or _SLAB_GRADE.search(n):
        return False
    if "slab" in set(tags):
        return False
    return not n.startswith("promo")


@dataclass(frozen=True)
class Candidate:
    product_id: int
    name: str
    set_name: str
    market_cents: int | None = None
    image_url: str | None = None


@dataclass(frozen=True)
class Prepared:
    candidate: Candidate
    name_words: frozenset[str]
    set_words: frozenset[str]


def prepare_catalog(candidates: Iterable[Candidate]) -> list[Prepared]:
    return [
        Prepared(c, frozenset(tokens(c.name)), frozenset(tokens(c.set_name))) for c in candidates
    ]


def score_match(item_words: frozenset[str], p: Prepared) -> float:
    if not item_words:
        return 0.0
    in_name = sum(1 for w in item_words if w in p.name_words)
    in_context = sum(1 for w in item_words if w in p.name_words or w in p.set_words)
    cover = in_context / len(item_words)
    union = len(item_words | p.name_words)
    jaccard = in_name / union
    extra_types = sum(1 for w in p.name_words if w in TYPE_WORDS and w not in item_words)
    return max(0.0, 0.6 * cover + 0.4 * jaccard - 0.2 * extra_types)


@dataclass(frozen=True)
class Match:
    status: str
    """confident | ambiguous | probable | weak | none | not_sealed"""
    options: list[tuple[Candidate, float]]


def match_item(
    name: str, tags: Iterable[str], catalog: Sequence[Prepared], limit: int = 3
) -> Match:
    if not is_sealed_candidate(name, tags):
        return Match("not_sealed", [])
    words = frozenset(tokens(name))
    scored: list[tuple[Candidate, float]] = []
    for p in catalog:
        s = score_match(words, p)
        if s > 0:
            scored.append((p.candidate, s))
    scored.sort(key=lambda t: (-t[1], t[0].product_id))
    options = scored[:limit]
    if not options or options[0][1] < WEAK_SCORE:
        return Match("none", options)
    best = options[0][1]
    if best >= CONFIDENT_SCORE:
        tied = [o for o in options if best - o[1] < TIE_MARGIN]
        return Match("ambiguous" if len(tied) > 1 else "confident", options)
    return Match("probable" if best >= PROBABLE_SCORE else "weak", options)


def price_sanity(item_usd: float | None, catalog_usd: float | None) -> str:
    """'ok' within a factor of two, 'differs' beyond it, 'unknown' if either is missing."""
    if not item_usd or not catalog_usd or item_usd <= 0 or catalog_usd <= 0:
        return "unknown"
    ratio = item_usd / catalog_usd
    return "ok" if 0.5 <= ratio <= 2 else "differs"


# ── The decision ───────────────────────────────────────────────────────────

# Currencies with no minor unit; mirrors the app's currency table.
_ZERO_DECIMAL = frozenset({"VND", "JPY", "KRW"})


def item_usd_cents(price_minor: int | None, currency: str | None, usd_to: Mapping[str, float]) -> int | None:
    """An item's price in US cents, using the stored USD->currency rates."""
    if not price_minor or not currency:
        return None
    exponent = 0 if currency in _ZERO_DECIMAL else 2
    major = price_minor / 10**exponent
    if currency == "USD":
        return round(major * 100)
    rate = usd_to.get(currency)
    if not rate or rate <= 0:
        return None
    return round(major / rate * 100)


def decide_auto_link(match: Match, item_usd: int | None) -> Candidate | None:
    """The product to link automatically, or None to leave it for a person.

    Only a `confident` match whose price doesn't contradict the item's own.
    """
    if match.status != "confident" or not match.options:
        return None
    best = match.options[0][0]
    cat_usd = None if best.market_cents is None else best.market_cents / 100
    item = None if item_usd is None else item_usd / 100
    if price_sanity(item, cat_usd) == "differs":
        return None
    return best


# ── The run ────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class HeldItem:
    id: str
    name: str
    tags: tuple[str, ...]
    price_minor: int | None
    currency: str | None
    image_url: str | None = None


@dataclass(frozen=True)
class LinkResult:
    considered: int
    """Held, not-yet-decided items looked at."""
    linked: list[tuple[str, str]]
    """(item name, product name) pairs linked, or that would be in a dry run."""
    left_for_review: int
    images_filled: int
    """Images set from the catalogue (in a dry run, only for items it would link)."""


def link_stock(*, dry_run: bool = False) -> LinkResult:
    """Link clear matches among the items you hold, then fill missing images."""
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.product_id, p.name, s.name AS set_name, p.image_url,
                   (SELECT cp.market_cents FROM catalog_prices cp
                     WHERE cp.product_id = p.product_id
                     ORDER BY cp.day DESC LIMIT 1) AS market_cents
              FROM catalog_products p
              JOIN catalog_sets s ON s.group_id = p.group_id
             WHERE p.kind = 'sealed'
            """
        )
        catalog = prepare_catalog(
            Candidate(
                product_id=int(r["product_id"]),
                name=r["name"],
                set_name=r["set_name"],
                market_cents=None if r["market_cents"] is None else int(r["market_cents"]),
                image_url=r["image_url"],
            )
            for r in cur.fetchall()
        )
        if not catalog:
            log.info("catalog-link: the catalogue has no sealed products yet")
            return LinkResult(0, [], 0, 0)

        cur.execute("SELECT quote, rate FROM fx_rates WHERE base = 'USD'")
        usd_to = {r["quote"]: float(r["rate"]) for r in cur.fetchall()}

        cur.execute(
            """
            SELECT i.id::text AS id, i.name, i.tags, i.image_url,
                   (SELECT m.price_cents FROM market_prices m
                     WHERE m.item_id = i.id ORDER BY m.fetched_at DESC LIMIT 1) AS price,
                   (SELECT m.currency FROM market_prices m
                     WHERE m.item_id = i.id ORDER BY m.fetched_at DESC LIMIT 1) AS currency
              FROM items i
             WHERE i.catalog_product_id IS NULL
               AND i.catalog_link_skipped = false
               AND i.catalog_link_source IS NULL
               AND COALESCE((
                     SELECT sum(CASE WHEN t.type = 'buy' AND t.status = 'received' THEN t.quantity
                                     WHEN t.type = 'sell' THEN -t.quantity
                                     ELSE 0 END)
                       FROM transactions t WHERE t.item_id = i.id), 0) > 0
             ORDER BY i.name
            """
        )
        held = [
            HeldItem(
                id=r["id"],
                name=r["name"],
                tags=tuple(r["tags"] or ()),
                price_minor=None if r["price"] is None else int(r["price"]),
                currency=r["currency"],
                image_url=r["image_url"],
            )
            for r in cur.fetchall()
        ]

        linked: list[tuple[str, str]] = []
        to_write: list[tuple[int, str, str | None]] = []
        review = 0
        filled = 0
        for it in held:
            m = match_item(it.name, it.tags, catalog)
            if m.status == "not_sealed":
                continue
            pick = decide_auto_link(m, item_usd_cents(it.price_minor, it.currency, usd_to))
            if pick is None:
                review += 1
                continue
            linked.append((it.name, pick.name))
            to_write.append((pick.product_id, it.id, pick.image_url))
            if not it.image_url and pick.image_url:
                filled += 1

        if not dry_run:
            for product_id, item_id, image in to_write:
                # The WHERE repeats the conditions, so a choice the person made
                # a moment ago (the app runs at the same time) is never undone.
                cur.execute(
                    """
                    UPDATE items
                       SET catalog_product_id = %s,
                           catalog_link_source = 'auto',
                           image_url = CASE WHEN COALESCE(image_url, '') = '' THEN %s
                                            ELSE image_url END
                     WHERE id = %s::uuid
                       AND catalog_product_id IS NULL
                       AND catalog_link_skipped = false
                       AND catalog_link_source IS NULL
                    """,
                    (product_id, image, item_id),
                )
                if cur.rowcount:
                    # Newly linked: give it its set's name as a tag.
                    tag_item_with_set(cur, item_id, product_id)
            # Any linked item with no image of its own gets the catalogue's.
            cur.execute(
                """
                UPDATE items i
                   SET image_url = p.image_url
                  FROM catalog_products p
                 WHERE i.catalog_product_id = p.product_id
                   AND COALESCE(i.image_url, '') = ''
                   AND COALESCE(p.image_url, '') <> ''
                """
            )
            filled += cur.rowcount or 0

    log.info(
        "catalog-link: %d held items considered, %d linked%s, %d left for review, %d images filled",
        len(held),
        len(linked),
        " (dry run)" if dry_run else "",
        review,
        filled,
    )
    return LinkResult(len(held), linked, review, filled)
