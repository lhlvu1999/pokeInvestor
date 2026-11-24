"""The sealed-product classifier must agree with the TypeScript one.

``fixtures/sealed_type_vectors.json`` holds product names with the kind the
TypeScript ``sealedType`` gives them (every tracked name in the catalogue plus
an even slice of the untracked ones, and some accent/spacing edge cases). The
same file is checked by ``src/lib/calc/sealed_type.test.ts``.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from poke_pipeline.sealed_type import sealed_type

VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "sealed_type_vectors.json").read_text(encoding="utf-8")
)


def test_vectors_are_loaded() -> None:
    assert len(VECTORS) > 1000
    assert {t for _, t in VECTORS} == {"box", "etb", "bundle", "pack", None}


def test_agrees_with_typescript_on_every_vector() -> None:
    wrong = [(n, want, sealed_type(n)) for n, want in VECTORS if sealed_type(n) != want]
    assert wrong == [], f"{len(wrong)} disagreements, first: {wrong[:5]}"


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        ("Lost Origin Booster Box", "box"),
        ("Guardians Rising Elite Trainer Box", "etb"),
        ("151 Booster Bundle", "bundle"),
        ("Black Bolt Booster Pack", "pack"),
        ("Crimson Haze Booster Box Case", None),
        ("Pitch Black Half Booster Box", None),
        ("Surging Sparks Pokemon Center Elite Trainer Box (Exclusive)", None),
        ("Flowing Fists Booster Pack Art Bundle (Set of 4)", None),
        ("Charizard ex Special Collection", None),
    ],
)
def test_known_names(name: str, kind: str | None) -> None:
    assert sealed_type(name) == kind
