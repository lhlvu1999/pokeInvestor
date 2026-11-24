from poke_pipeline.catalog_images import (
    Card,
    CardIndex,
    match_slab,
    norm_number,
    parse_slab,
)


def card(pid, name, number, set_name="Set", language="en", image="http://i/x.jpg"):
    return Card(pid, name, set_name, language, number, image)


def test_norm_number_drops_leading_zeros_but_keeps_letters():
    assert norm_number("083/071") == "83/71"
    assert norm_number("032") == "32"
    assert norm_number("SWSH050") == "swsh50"
    assert norm_number("GG12/GG70") == "gg12/gg70"


def test_parse_slab_reads_words_number_and_language():
    s = parse_slab("slab psa 10 Charizard ex 331/190 jp")
    assert s is not None
    assert s.words == {"charizard", "ex"}
    assert s.number == "331/190"
    assert s.language == "ja"


def test_parse_slab_grade_is_not_a_name_word():
    # The grade must not leak into the card's words, or nothing ever matches.
    for name in ("slab psa 10 Mewtwo 183/165", "slab psa10 mewtwo 183/165", "psa 9 Mewtwo 183/165"):
        s = parse_slab(name)
        assert s is not None and s.words == {"mewtwo"}, name


def test_parse_slab_handles_odd_orders_and_promo_numbers():
    s = parse_slab("slab ex psa 10 zapdos ex 204/165 JP")
    assert s is not None and s.words == {"ex", "zapdos"} and s.number == "204/165"
    s = parse_slab("slab tag 10 oricorio ex 024")
    assert s is not None and s.number == "24" and s.language == "en"
    s = parse_slab("slab psa 10 Charizard V SWSH050")
    assert s is not None and s.number == "swsh50"


def test_a_product_that_merely_starts_with_tag_is_not_a_slab():
    assert parse_slab("Tag Team Collection 12/34") is None
    assert parse_slab("Tag Team GX Box SM12") is None
    # ...but a TAG-graded slab still is.
    s = parse_slab("tag 10 oricorio ex 024")
    assert s is not None and s.words == {"oricorio", "ex"}


def test_parse_slab_needs_a_slab_and_a_number():
    assert parse_slab("Stellar Crown Booster Box") is None
    assert parse_slab("slab psa 10 Pikachu") is None
    assert parse_slab("slab psa 10 262/172") is None  # no name


def test_match_requires_number_language_and_every_word():
    index = CardIndex.build(
        [
            card(1, "Charizard ex - 331/190", "331/190", language="ja"),
            card(2, "Charizard ex - 331/190", "331/190", language="en"),
            card(3, "Charizard - 331/190", "331/190", language="ja"),
        ]
    )
    slab = parse_slab("slab psa 10 Charizard ex 331/190 jp")
    assert slab is not None
    got = match_slab(slab, index)
    assert got is not None and got.product_id == 1  # not the English one, not the non-ex


def test_match_is_leading_zero_insensitive():
    index = CardIndex.build([card(1, "Farigiraf - 083/071", "083/071", language="ja")])
    slab = parse_slab("slab psa 10 farigiraf 83/71 jp")
    assert slab is not None and match_slab(slab, index) is not None


def test_two_candidates_means_no_match():
    index = CardIndex.build(
        [
            card(1, "Eevee - 173/191", "173/191", set_name="A"),
            card(2, "Eevee - 173/165", "173/165", set_name="B"),
        ]
    )
    # A number with no total fits both sets: too ambiguous to guess.
    slab = parse_slab("slab psa 10 Eevee 173")
    assert slab is not None and match_slab(slab, index) is None
    # With the total it is exact.
    slab = parse_slab("slab psa 10 Eevee 173/191")
    assert slab is not None
    got = match_slab(slab, index)
    assert got is not None and got.product_id == 1


def test_a_total_that_differs_is_not_a_match():
    index = CardIndex.build([card(1, "Reshiram - 113/100", "113/100")])
    slab = parse_slab("slab psa 10 reshiram 113/114")
    assert slab is not None and match_slab(slab, index) is None


def test_cards_without_a_picture_or_number_are_ignored():
    index = CardIndex.build(
        [card(1, "Mewtwo - 5/10", "5/10", image=""), card(2, "Mewtwo", None)]
    )
    slab = parse_slab("slab psa 10 mewtwo 5/10")
    assert slab is not None and match_slab(slab, index) is None


# ── link_slabs, with a stand-in database ───────────────────────────────────


class _FakeDb:
    """Answers the three queries link_slabs makes and records its updates."""

    def __init__(self, cards, items):
        self.cards = cards
        self.items = items
        self.updates: list[tuple] = []
        self.tag_updates: list[tuple] = []
        self.rowcount = 1
        self._one: dict | None = None
        self._rows: list[dict] = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def cursor(self):
        return self

    def execute(self, sql, params=None):
        if "WHERE p.product_id = %s" in sql:
            # The set lookup made for a newly matched card's set tag.
            self._one = {"name": "SV4a: Shiny Treasure ex", "language": "ja"}
        elif "array_append(tags" in sql:
            self.tag_updates.append(params)
            self.rowcount = 1
        elif "FROM catalog_products" in sql:
            self._rows = self.cards
        elif "FROM items" in sql:
            self._rows = self.items
        elif "UPDATE items SET raw_card_product_id" in sql:
            self.updates.append(params)
            self._rows = []

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._one


def _card_row(pid, name, number, language="ja", set_name="Set"):
    return {
        "product_id": pid, "name": name, "set_name": set_name, "language": language,
        "card_number": number, "image_url": "http://i/x.jpg",
    }


def _run(monkeypatch, cards, items, dry_run=False):
    from poke_pipeline import catalog_images as ci

    db = _FakeDb(cards, items)
    monkeypatch.setattr(ci, "connection", lambda: db)
    return ci.link_slabs(dry_run=dry_run), db


def test_link_slabs_matches_only_clear_slabs(monkeypatch):
    cards = [_card_row(11, "Charizard ex - 331/190", "331/190")]
    items = [
        {"id": "00000000-0000-4000-8000-000000000001", "name": "slab psa 10 Charizard ex 331/190 jp"},
        {"id": "00000000-0000-4000-8000-000000000002", "name": "slab psa 10 Mystery 5/5"},  # no such card
        {"id": "00000000-0000-4000-8000-000000000003", "name": "Stellar Crown Booster Box"},  # not a slab
    ]
    result, db = _run(monkeypatch, cards, items)
    assert [i for i, _ in result.linked] == ["slab psa 10 Charizard ex 331/190 jp"]
    assert result.considered == 2  # the two slabs; the box is not one
    assert db.updates == [(11, "00000000-0000-4000-8000-000000000001")]
    # The newly matched slab is given its card's set as a tag.
    assert [t[0] for t in db.tag_updates] == ["shiny treasure ex (jp)"]


def test_link_slabs_dry_run_writes_nothing(monkeypatch):
    cards = [_card_row(11, "Charizard ex - 331/190", "331/190")]
    items = [{"id": "00000000-0000-4000-8000-000000000001", "name": "slab psa 10 Charizard ex 331/190 jp"}]
    result, db = _run(monkeypatch, cards, items, dry_run=True)
    assert len(result.linked) == 1
    assert db.updates == []


def test_link_slabs_never_guesses_between_two_cards(monkeypatch):
    cards = [
        _card_row(11, "Eevee - 173/191", "173/191", set_name="A"),
        _card_row(12, "Eevee - 173/165", "173/165", set_name="B"),
    ]
    items = [{"id": "00000000-0000-4000-8000-000000000001", "name": "slab psa 10 Eevee 173 jp"}]
    result, db = _run(monkeypatch, cards, items)
    assert result.linked == [] and db.updates == []
