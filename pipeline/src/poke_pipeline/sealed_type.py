"""Which kind of sealed product a TCGplayer name is.

A port of ``src/lib/calc/sealed_type.ts``; the two are held together by
``tests/fixtures/sealed_type_vectors.json``, which both test suites check.
Only the four mainstream kinds are tracked. Everything else (cases, half
boxes, mini tins, blisters, collections, exclusives, art bundles) is ``None``:
its price behaves differently and would blur the kinds worth watching.
"""

from __future__ import annotations

import re
from typing import Literal

SealedType = Literal["box", "etb", "bundle", "pack"]

SEALED_TYPES: tuple[SealedType, ...] = ("box", "etb", "bundle", "pack")

SEALED_TYPE_LABELS: dict[str, str] = {
    "box": "Booster boxes",
    "etb": "Elite Trainer Boxes",
    "bundle": "Booster bundles",
    "pack": "Booster packs",
}

# re.ASCII makes \b and \d behave like JavaScript's, so a name with an accented
# letter at a word edge is classified the same way by both implementations.
_FLAGS = re.ASCII | re.IGNORECASE

_NOT_PLAIN = re.compile(
    r"\b(case|half|mini|display|build|battle|sleeved|blister|pokemon center|"
    r"costco|target|walmart|exclusive|art bundle|set of|\d+\s*-?\s*pack)\b",
    _FLAGS,
)
_BOX = re.compile(r"\bbooster box\b", _FLAGS)
_ETB = re.compile(r"\belite trainer box\b", _FLAGS)
_BUNDLE = re.compile(r"\bbooster bundle\b", _FLAGS)
_PACK = re.compile(r"\bbooster pack\b", _FLAGS)


def sealed_type(name: str) -> SealedType | None:
    """The kind of a sealed product, or ``None`` if it isn't one of the four."""
    n = name.lower()
    if _NOT_PLAIN.search(n):
        return None
    if _BOX.search(n):
        return "box"
    if _ETB.search(n):
        return "etb"
    if _BUNDLE.search(n):
        return "bundle"
    if _PACK.search(n):
        return "pack"
    return None
