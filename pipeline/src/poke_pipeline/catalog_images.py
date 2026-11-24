"""Fill missing item pictures from the catalogue, without linking anything.

`catalog_link.link_stock` already links the sealed products you HOLD and fills
their pictures. That leaves two groups with no picture:

- Sealed products you have since sold. They are not held, so the link step
  never looks at them. A clear match gives the picture; the item is NOT linked,
  so nothing about prices or returns changes.
- Graded slabs. A slab is a single card, and the card's catalogue entry has a
  picture. A slab's name carries the card number ("... Charizard ex 331/190
  jp"), which is what makes a safe match possible.

Care taken, same as the link step:
- Only items with no picture; a picture you set yourself is never replaced.
- Only a clear, single answer. A slab must match a card number, a language and
  every word of the card's name, with exactly one such card in the catalogue.
  Anything else is left alone for you to do by hand.
- Items you skipped in the link screen are left alone.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from poke_pipeline import catalog_link as cl
from poke_pipeline.db import connection
from poke_pipeline.set_tags import tag_item_with_set

if TYPE_CHECKING:
    from collections.abc import Iterable

log = logging.getLogger(__name__)

_A = re.ASCII
_SLAB_WORD = re.compile(r"\bslab\b", _A)
_GRADE = re.compile(r"\b(?:psa|bgs|cgc|tag)\s*\d+(?:\.\d+)?\b", _A)
# "tag" is also an ordinary word ("Tag Team Collection"): it only starts a slab
# name when a grade follows it.
_GRADER_START = re.compile(r"^(?:(?:slab|psa|bgs|cgc)\b|tag\s*\d)", _A)
_NUMBER = re.compile(r"^[a-z]*\d+(?:/[a-z0-9-]+)?$", _A)
_JAPANESE = re.compile(r"\b(?:jp|jpn|japan(?:ese)?)\b", _A)
_LEADING_ZEROS = re.compile(r"(?<![0-9])0+(?=[0-9])")


def norm_number(s: str) -> str:
    """Lowercase, and drop leading zeros so '083/071' meets '83/71'."""
    return _LEADING_ZEROS.sub("", s.strip().lower())


@dataclass(frozen=True)
class Slab:
    words: frozenset[str]
    number: str
    """Normalised card number as written, e.g. '331/190', 'swsh50', '173'."""
    language: str


def parse_slab(name: str) -> Slab | None:
    """Card words, number and language from a slab's name, or None when it
    carries no card number (then there is nothing safe to match on)."""
    n = name.lower().strip()
    if not (_GRADER_START.match(n) or _GRADE.search(n)):
        return None
    language = "ja" if _JAPANESE.search(n) else "en"
    n = _GRADE.sub(" ", n)
    n = _SLAB_WORD.sub(" ", n)
    n = _JAPANESE.sub(" ", n)
    parts = n.split()
    number = None
    for i in range(len(parts) - 1, -1, -1):
        if _NUMBER.match(parts[i]):
            number = parts.pop(i)
            break
    if number is None:
        return None
    words = frozenset(cl.tokens(" ".join(parts)))
    if not words:
        return None
    return Slab(words, norm_number(number), language)


@dataclass(frozen=True)
class Card:
    product_id: int
    name: str
    set_name: str
    language: str
    number: str | None
    image_url: str


@dataclass
class CardIndex:
    by_number: dict[tuple[str, str], list[tuple[Card, frozenset[str]]]] = field(
        default_factory=dict
    )

    @staticmethod
    def build(cards: Iterable[Card]) -> CardIndex:
        idx = CardIndex()
        for c in cards:
            if not c.number or not c.image_url:
                continue
            first = norm_number(c.number).split("/")[0]
            idx.by_number.setdefault((c.language, first), []).append(
                (c, frozenset(cl.tokens(c.name)))
            )
        return idx


def match_slab(slab: Slab, index: CardIndex) -> Card | None:
    """The one card this slab is, or None when there is none or more than one."""
    first = slab.number.split("/")[0]
    found: list[Card] = []
    for card, name_words in index.by_number.get((slab.language, first), []):
        assert card.number is not None
        if "/" in slab.number and norm_number(card.number) != slab.number:
            continue
        if not slab.words <= name_words:
            continue
        found.append(card)
    return found[0] if len(found) == 1 else None


def load_card_index(cur: Any) -> CardIndex:
    """Every catalogue card that has a number and a picture, indexed for matching."""
    cur.execute(
        """
        SELECT p.product_id, p.name, s.name AS set_name, s.language,
               p.card_number, p.image_url
          FROM catalog_products p
          JOIN catalog_sets s ON s.group_id = p.group_id
         WHERE p.kind = 'card' AND COALESCE(p.image_url, '') <> ''
           AND p.card_number IS NOT NULL
        """
    )
    return CardIndex.build(
        Card(
            product_id=int(r["product_id"]),
            name=r["name"],
            set_name=r["set_name"],
            language=r["language"],
            number=r["card_number"],
            image_url=r["image_url"],
        )
        for r in cur.fetchall()
    )


@dataclass(frozen=True)
class FillResult:
    sealed: list[tuple[str, str]]
    """(item, catalogue product) for sold sealed items given a picture."""
    slabs: list[tuple[str, str]]
    """(item, card with set) for slabs given a picture."""
    left: int
    """Items with no picture that this step could not place."""


def fill_images(*, dry_run: bool = False) -> FillResult:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.product_id, p.name, s.name AS set_name, p.image_url,
                   (SELECT cp.market_cents FROM catalog_prices cp
                     WHERE cp.product_id = p.product_id
                     ORDER BY cp.day DESC LIMIT 1) AS market_cents
              FROM catalog_products p
              JOIN catalog_sets s ON s.group_id = p.group_id
             WHERE p.kind = 'sealed' AND COALESCE(p.image_url, '') <> ''
            """
        )
        sealed_catalog = cl.prepare_catalog(
            cl.Candidate(
                product_id=int(r["product_id"]),
                name=r["name"],
                set_name=r["set_name"],
                market_cents=None if r["market_cents"] is None else int(r["market_cents"]),
                image_url=r["image_url"],
            )
            for r in cur.fetchall()
        )
        index = load_card_index(cur)
        cur.execute("SELECT quote, rate FROM fx_rates WHERE base = 'USD'")
        usd_to = {r["quote"]: float(r["rate"]) for r in cur.fetchall()}

        cur.execute(
            """
            SELECT i.id::text AS id, i.name, i.tags,
                   (SELECT m.price_cents FROM market_prices m
                     WHERE m.item_id = i.id ORDER BY m.fetched_at DESC LIMIT 1) AS price,
                   (SELECT m.currency FROM market_prices m
                     WHERE m.item_id = i.id ORDER BY m.fetched_at DESC LIMIT 1) AS currency
              FROM items i
             WHERE COALESCE(i.image_url, '') = ''
               AND i.catalog_product_id IS NULL
               AND i.catalog_link_skipped = false
             ORDER BY i.name
            """
        )
        rows = cur.fetchall()

        sealed: list[tuple[str, str]] = []
        slabs: list[tuple[str, str]] = []
        writes: list[tuple[str, str]] = []
        left = 0
        for r in rows:
            name = r["name"]
            tags = tuple(r["tags"] or ())
            slab = parse_slab(name)
            if slab is not None or not cl.is_sealed_candidate(name, tags):
                card = match_slab(slab, index) if slab is not None else None
                if card is None:
                    left += 1
                    continue
                slabs.append((name, f"{card.name} ({card.set_name})"))
                writes.append((r["id"], card.image_url))
                continue
            m = cl.match_item(name, tags, sealed_catalog)
            pick = cl.decide_auto_link(
                m, cl.item_usd_cents(r["price"], r["currency"], usd_to)
            )
            if pick is None or not pick.image_url:
                left += 1
                continue
            sealed.append((name, pick.name))
            writes.append((r["id"], pick.image_url))

        if not dry_run:
            for item_id, image in writes:
                # The WHERE repeats the condition, so a picture added by hand a
                # moment ago (the app runs at the same time) is never replaced.
                cur.execute(
                    """
                    UPDATE items SET image_url = %s
                     WHERE id = %s::uuid AND COALESCE(image_url, '') = ''
                    """,
                    (image, item_id),
                )

    log.info(
        "catalog-images: %d sealed + %d slab pictures%s, %d items left",
        len(sealed),
        len(slabs),
        " (dry run)" if dry_run else " filled",
        left,
    )
    return FillResult(sealed, slabs, left)


@dataclass(frozen=True)
class SlabLinkResult:
    linked: list[tuple[str, str]]
    """(slab item, card with set) matched, or that would be in a dry run."""
    considered: int
    """Slabs not yet matched and not marked wrong by you."""


def link_slabs(*, dry_run: bool = False) -> SlabLinkResult:
    """Match graded slabs to the catalogue card they are, so the card's raw price
    can be kept and compared with the slab's value.

    Same bar as the picture fill: card number, language and every word of the
    card's name must agree and exactly one card may fit. Never touches a slab you
    marked as wrongly matched (``raw_card_skipped``), and never changes a match
    that already exists.
    """
    with connection() as conn, conn.cursor() as cur:
        index = load_card_index(cur)
        cur.execute(
            """
            SELECT id::text AS id, name FROM items
             WHERE raw_card_product_id IS NULL AND raw_card_skipped = false
             ORDER BY name
            """
        )
        rows = cur.fetchall()
        linked: list[tuple[str, str]] = []
        writes: list[tuple[int, str]] = []
        considered = 0
        for r in rows:
            slab = parse_slab(r["name"])
            if slab is None:
                continue
            considered += 1
            card = match_slab(slab, index)
            if card is None:
                continue
            linked.append((r["name"], f"{card.name} ({card.set_name})"))
            writes.append((card.product_id, r["id"]))
        if not dry_run:
            for product_id, item_id in writes:
                # The WHERE repeats the conditions, so a choice made in the app a
                # moment ago is never undone.
                cur.execute(
                    """
                    UPDATE items SET raw_card_product_id = %s
                     WHERE id = %s::uuid AND raw_card_product_id IS NULL
                       AND raw_card_skipped = false
                    """,
                    (product_id, item_id),
                )
                if cur.rowcount:
                    tag_item_with_set(cur, item_id, product_id)
    log.info(
        "catalog-slabs: %d slabs considered, %d matched%s",
        considered,
        len(linked),
        " (dry run)" if dry_run else "",
    )
    return SlabLinkResult(linked, considered)
