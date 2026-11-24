"""Tests for the catalogue sync rules.

The rules that decide what ends up in the database — what a card is worth,
what a set totals, which sets to re-read, when to snapshot the top cards —
are pure and tested directly. The archive reader is tested against a real
(tiny) 7z built in the test, so the format handling is exercised for real.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import py7zr

from poke_pipeline import catalog as c
from poke_pipeline.catalog import PriceRow


def row(pid: int, variant: str | None, market: int | None) -> PriceRow:
    return PriceRow(pid, variant, market, None, None, None)


# ── cents ──────────────────────────────────────────────────────────────────


def test_cents_rounds_dollars_to_whole_cents() -> None:
    assert c.cents(133.52) == 13352
    assert c.cents(0.1 + 0.2) == 30  # float noise must not leak into cents
    assert c.cents(0) == 0
    assert c.cents(7) == 700


def test_cents_rejects_missing_negative_and_junk() -> None:
    for bad in (None, -1.0, "12.50", float("nan"), True, [], {}):
        assert c.cents(bad) is None


# ── prices ─────────────────────────────────────────────────────────────────


def test_parse_price_rows_groups_printings_by_product() -> None:
    rows = c.parse_price_rows(
        [
            {"productId": 1, "subTypeName": "Normal", "marketPrice": 1.5, "lowPrice": 1.0},
            {"productId": 1, "subTypeName": "Holofoil", "marketPrice": 9.99},
            {"productId": 2, "subTypeName": "Normal", "marketPrice": None},
            {"productId": "oops", "marketPrice": 5},
            {"subTypeName": "Normal"},
        ]
    )
    assert set(rows) == {1, 2}
    assert [r.variant for r in rows[1]] == ["Normal", "Holofoil"]
    assert rows[1][0].market == 150 and rows[1][0].low == 100
    assert rows[2][0].market is None


def test_best_price_is_the_highest_market_across_printings() -> None:
    best = c.best_price([row(1, "Normal", 150), row(1, "Holofoil", 999), row(1, "Reverse", 300)])
    assert best is not None and best.variant == "Holofoil" and best.market == 999


def test_best_price_ignores_unpriced_printings_and_can_be_none() -> None:
    best = c.best_price([row(1, "Normal", None), row(1, "Holofoil", 5)])
    assert best is not None and best.market == 5
    assert c.best_price([row(1, "Normal", None)]) is None
    assert c.best_price([]) is None


# ── classification ─────────────────────────────────────────────────────────


def test_classify_product_cards_have_a_number_or_rarity() -> None:
    card = {"extendedData": [{"name": "Number", "value": "001/100"}]}
    rarity_only = {"extendedData": [{"name": "Rarity", "value": "Rare"}]}
    sealed = {"extendedData": []}
    assert c.classify_product(card) == "card"
    assert c.classify_product(rarity_only) == "card"
    assert c.classify_product(sealed) == "sealed"
    assert c.classify_product({}) == "sealed"
    assert c.classify_product({"extendedData": None}) == "sealed"


def test_extended_value_reads_a_named_field() -> None:
    p = {"extendedData": [{"name": "Rarity", "value": "Rare"}, {"name": "Number", "value": ""}]}
    assert c.extended_value(p, "Rarity") == "Rare"
    assert c.extended_value(p, "Number") is None
    assert c.extended_value(p, "Missing") is None


# ── set aggregates ─────────────────────────────────────────────────────────


def prices_for(values: dict[int, int]) -> dict[int, list[PriceRow]]:
    return {pid: [row(pid, "Normal", v)] for pid, v in values.items()}


def test_aggregate_totals_top_ten_and_top_twenty() -> None:
    ids = list(range(1, 31))  # 30 cards worth 100, 200, ... 3000 cents
    agg = c.aggregate_set(ids, prices_for({i: i * 100 for i in ids}))
    assert agg.card_count == 30 and agg.priced_count == 30
    assert agg.total == sum(i * 100 for i in ids)
    assert agg.top10 == sum(i * 100 for i in range(21, 31))
    assert agg.top20 == sum(i * 100 for i in range(11, 31))
    assert len(agg.top) == 20
    assert agg.top[0].product_id == 30 and agg.top[-1].product_id == 11


def test_aggregate_counts_unpriced_cards_but_adds_nothing_for_them() -> None:
    agg = c.aggregate_set([1, 2, 3], prices_for({1: 500}))
    assert agg.card_count == 3 and agg.priced_count == 1
    assert agg.total == 500 and agg.top10 == 500


def test_aggregate_uses_each_cards_best_printing() -> None:
    prices = {
        1: [row(1, "Normal", 100), row(1, "Holofoil", 900)],
        2: [row(2, "Normal", 400)],
    }
    agg = c.aggregate_set([1, 2], prices)
    assert agg.total == 1300  # not 100 + 900 + 400
    assert agg.top[0].variant == "Holofoil"


def test_aggregate_ties_are_ordered_by_product_id_every_time() -> None:
    prices = prices_for({7: 500, 3: 500, 5: 500})
    a = c.aggregate_set([7, 3, 5], prices)
    b = c.aggregate_set([5, 7, 3], prices)
    assert [t.product_id for t in a.top] == [3, 5, 7] == [t.product_id for t in b.top]


def test_aggregate_of_an_empty_set_is_all_zero() -> None:
    agg = c.aggregate_set([], {})
    assert (agg.card_count, agg.priced_count, agg.total, agg.top10, agg.top20) == (0, 0, 0, 0, 0)
    assert agg.top == ()


def test_aggregate_ignores_prices_of_non_cards() -> None:
    # A sealed product's price is in the same file but is not a card.
    agg = c.aggregate_set([1], prices_for({1: 100, 99: 99999}))
    assert agg.total == 100


# ── when to refresh / snapshot ─────────────────────────────────────────────

NOW = datetime(2026, 11, 23, 21, 0, tzinfo=UTC)


def test_refresh_when_never_read_or_a_product_is_unknown() -> None:
    old = date(2020, 1, 1)
    assert c.needs_products_refresh(
        synced_at=None, published_on=old, has_unknown_products=False, now=NOW
    )
    assert c.needs_products_refresh(
        synced_at=NOW - timedelta(hours=1),
        published_on=old,
        has_unknown_products=True,
        now=NOW,
    )


def test_recent_sets_are_re_read_daily_but_not_twice_a_day() -> None:
    young = date(2026, 10, 1)
    assert c.needs_products_refresh(
        synced_at=NOW - timedelta(hours=24),
        published_on=young,
        has_unknown_products=False,
        now=NOW,
    )
    assert not c.needs_products_refresh(
        synced_at=NOW - timedelta(hours=3),
        published_on=young,
        has_unknown_products=False,
        now=NOW,
    )


def test_old_sets_are_only_re_read_monthly() -> None:
    old = date(2022, 5, 1)
    assert not c.needs_products_refresh(
        synced_at=NOW - timedelta(days=10),
        published_on=old,
        has_unknown_products=False,
        now=NOW,
    )
    assert c.needs_products_refresh(
        synced_at=NOW - timedelta(days=31),
        published_on=old,
        has_unknown_products=False,
        now=NOW,
    )


def test_a_set_with_no_publish_date_is_treated_as_old() -> None:
    assert not c.needs_products_refresh(
        synced_at=NOW - timedelta(days=2),
        published_on=None,
        has_unknown_products=False,
        now=NOW,
    )


def test_top_cards_are_snapshotted_weekly_and_always_the_first_time() -> None:
    today = date(2026, 11, 23)
    assert c.should_snapshot_top(None, today)
    assert not c.should_snapshot_top(today - timedelta(days=6), today)
    assert c.should_snapshot_top(today - timedelta(days=7), today)
    assert c.should_snapshot_top(today - timedelta(days=30), today)


# ── archive days and URLs ──────────────────────────────────────────────────


def test_archive_days_try_today_then_yesterday_in_utc() -> None:
    assert c.candidate_archive_days(NOW) == [date(2026, 11, 23), date(2026, 11, 22)]
    # 23:30 on the 22nd in UTC-5 is already the 23rd in UTC.
    from datetime import timezone

    late = datetime(2026, 11, 22, 23, 30, tzinfo=timezone(timedelta(hours=-5)))
    assert c.candidate_archive_days(late)[0] == date(2026, 11, 23)


def test_archive_url() -> None:
    assert (
        c.archive_url(date(2026, 11, 22))
        == "https://tcgcsv.com/archive/tcgplayer/prices-2026-11-22.ppmd.7z"
    )


def test_parse_published() -> None:
    assert c.parse_published("2026-11-06T00:00:00") == date(2026, 11, 6)
    for bad in (None, "", "soon", 20261106, "2026-13-45T00:00:00"):
        assert c.parse_published(bad) is None


# ── reading a real archive ─────────────────────────────────────────────────


def test_read_archive_prices_returns_only_pokemon_categories(tmp_path: Path) -> None:
    day = date(2026, 11, 22)
    src = tmp_path / "src"
    files = {
        f"{day}/3/100/prices": {"results": [{"productId": 1, "marketPrice": 2.5}]},
        f"{day}/85/200/prices": {"results": [{"productId": 2, "marketPrice": 4.0}]},
        f"{day}/1/300/prices": {"results": [{"productId": 3, "marketPrice": 9.0}]},  # not Pokémon
        f"{day}/3/100/notprices": {"results": []},
    }
    for rel, payload in files.items():
        p = src / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(payload))
    archive = tmp_path / "prices.7z"
    with py7zr.SevenZipFile(archive, "w") as z:
        z.writeall(src, arcname="")

    out = c.read_archive_prices(archive, day)
    assert set(out) == {(3, 100), (85, 200)}
    assert out[(3, 100)][0]["productId"] == 1
    assert out[(85, 200)][0]["marketPrice"] == 4.0


def test_read_archive_prices_ignores_a_different_day(tmp_path: Path) -> None:
    src = tmp_path / "src" / "2026-11-21" / "3" / "100"
    src.mkdir(parents=True)
    (src / "prices").write_text(json.dumps({"results": [{"productId": 1}]}))
    archive = tmp_path / "prices.7z"
    with py7zr.SevenZipFile(archive, "w") as z:
        z.writeall(tmp_path / "src", arcname="")
    assert c.read_archive_prices(archive, date(2026, 11, 22)) == {}


# ── product rows ───────────────────────────────────────────────────────────


def test_product_rows_keep_metadata_and_skip_malformed_entries() -> None:
    rows = c._product_rows(
        5,
        [
            {
                "productId": 10,
                "name": "Elite Trainer Box",
                "imageUrl": "https://img/10.jpg",
                "url": "https://tcg/10",
                "extendedData": [],
            },
            {
                "productId": 11,
                "name": "Pikachu",
                "extendedData": [
                    {"name": "Rarity", "value": "Common"},
                    {"name": "Number", "value": "025/100"},
                ],
            },
            {"productId": "bad", "name": "x"},
            {"productId": 12},
        ],
    )
    assert rows[0] == (10, 5, "Elite Trainer Box", "sealed", None, None, "https://img/10.jpg", "https://tcg/10")
    assert rows[1][3:6] == ("card", "Common", "025/100")
    assert len(rows) == 2


# ── backfill planning ──────────────────────────────────────────────────────


def test_plan_backfill_days_is_inclusive_and_newest_first_by_default() -> None:
    days = c.plan_backfill_days(date(2026, 1, 1), date(2026, 1, 4), [])
    assert days == [date(2026, 1, 4), date(2026, 1, 3), date(2026, 1, 2), date(2026, 1, 1)]


def test_plan_backfill_days_can_run_oldest_first() -> None:
    days = c.plan_backfill_days(date(2026, 1, 1), date(2026, 1, 3), [], newest_first=False)
    assert days == [date(2026, 1, 1), date(2026, 1, 2), date(2026, 1, 3)]


def test_plan_backfill_days_skips_what_is_already_stored() -> None:
    have = [date(2026, 1, 2), date(2026, 1, 3), date(2025, 12, 1)]
    days = c.plan_backfill_days(date(2026, 1, 1), date(2026, 1, 4), have)
    assert days == [date(2026, 1, 4), date(2026, 1, 1)]


def test_plan_backfill_days_limit_keeps_the_first_in_order() -> None:
    days = c.plan_backfill_days(date(2026, 1, 1), date(2026, 1, 10), [], limit=3)
    assert days == [date(2026, 1, 10), date(2026, 1, 9), date(2026, 1, 8)]


def test_plan_backfill_days_empty_when_everything_is_done_or_range_is_reversed() -> None:
    assert c.plan_backfill_days(date(2026, 1, 1), date(2026, 1, 1), [date(2026, 1, 1)]) == []
    assert c.plan_backfill_days(date(2026, 1, 5), date(2026, 1, 1), []) == []


def test_top_lists_are_kept_on_sundays_when_backfilling() -> None:
    sunday = date(2026, 11, 22)
    assert sunday.weekday() == 6 and c.is_snapshot_day(sunday)
    assert not any(c.is_snapshot_day(sunday + timedelta(days=i)) for i in range(1, 7))
    assert c.is_snapshot_day(sunday + timedelta(days=7))


# ── compute_day: the rules shared by sync and backfill ─────────────────────

DAY = date(2026, 5, 1)


def results(*rows: tuple[int, str, float | None]) -> list[dict[str, object]]:
    return [{"productId": p, "subTypeName": v, "marketPrice": m} for p, v, m in rows]


def test_compute_day_splits_sealed_prices_from_card_totals() -> None:
    known = {100: {1: "card", 2: "card", 9: "sealed"}}
    archive = {(3, 100): results((1, "Normal", 10.0), (2, "Normal", 5.0), (9, "Normal", 120.0))}
    out = c.compute_day(
        day=DAY, archive=archive, known=known, set_ids={100}, wants_top=lambda _g: False
    )
    assert out.sealed == [(9, DAY, 12000, None, None, None)]
    assert out.daily == [(100, DAY, 2, 2, 1500, 1500, 1500)]
    assert out.top == [] and out.skipped == 0


def test_compute_day_skips_prices_of_products_we_do_not_know() -> None:
    # Product 7 (a card TCGplayer has since removed) must not count or crash.
    known = {100: {1: "card"}}
    archive = {(3, 100): results((1, "Normal", 10.0), (7, "Normal", 999.0))}
    out = c.compute_day(
        day=DAY, archive=archive, known=known, set_ids={100}, wants_top=lambda _g: False
    )
    assert out.daily[0][4] == 1000


def test_compute_day_skips_sets_without_known_products_or_not_in_the_catalogue() -> None:
    known = {100: {1: "card"}}
    archive = {
        (3, 100): results((1, "Normal", 1.0)),
        (3, 200): results((5, "Normal", 1.0)),  # no products known
        (3, 300): results((6, "Normal", 1.0)),  # not a catalogue set
    }
    out = c.compute_day(
        day=DAY, archive=archive, known=known, set_ids={100, 200}, wants_top=lambda _g: False
    )
    assert [r[0] for r in out.daily] == [100]
    assert out.skipped == 2


def test_compute_day_only_keeps_top_cards_for_sets_that_want_them() -> None:
    known = {100: {1: "card", 2: "card"}, 101: {3: "card"}}
    archive = {
        (3, 100): results((1, "Normal", 10.0), (2, "Normal", 30.0)),
        (3, 101): results((3, "Normal", 7.0)),
    }
    out = c.compute_day(
        day=DAY, archive=archive, known=known, set_ids={100, 101}, wants_top=lambda g: g == 100
    )
    assert [(r[0], r[2], r[3]) for r in out.top] == [(100, 1, 2), (100, 2, 1)]
    assert {r[0] for r in out.daily} == {100, 101}  # totals are kept for both


def test_compute_day_with_an_empty_archive_is_empty() -> None:
    out = c.compute_day(
        day=DAY, archive={}, known={100: {1: "card"}}, set_ids={100}, wants_top=lambda _g: True
    )
    assert (out.sealed, out.daily, out.top, out.skipped) == ([], [], [], 0)


def test_compute_day_keeps_the_price_of_cards_that_slabs_are_matched_to() -> None:
    known = {100: {1: "card", 2: "card", 9: "sealed"}}
    archive = {
        (3, 100): [
            {"productId": 1, "subTypeName": "Normal", "marketPrice": 4.0},
            {"productId": 1, "subTypeName": "Holofoil", "marketPrice": 10.0},
            {"productId": 2, "subTypeName": "Normal", "marketPrice": 5.0},
            {"productId": 9, "subTypeName": "Normal", "marketPrice": 120.0},
        ]
    }
    out = c.compute_day(
        day=DAY,
        archive=archive,
        known=known,
        set_ids={100},
        wants_top=lambda _g: False,
        linked_cards=[1, 1, 77],  # a duplicate, and a card with no price today
    )
    # One row for card 1, at its best printing; none for 2 (not linked) or 77.
    assert out.cards == [(1, DAY, 1000, None, None, None)]
    # Sealed rows and set totals are unaffected.
    assert out.sealed == [(9, DAY, 12000, None, None, None)]
    assert out.daily == [(100, DAY, 2, 2, 1500, 1500, 1500)]


def test_compute_day_has_no_card_rows_unless_asked() -> None:
    out = c.compute_day(
        day=DAY,
        archive={(3, 100): results((1, "Normal", 10.0))},
        known={100: {1: "card"}},
        set_ids={100},
        wants_top=lambda _g: False,
    )
    assert out.cards == []


def test_write_day_stores_card_prices_beside_sealed_ones() -> None:
    class Cur:
        def __init__(self) -> None:
            self.calls: list[tuple[str, list[tuple[object, ...]]]] = []

        def __enter__(self):
            return self

        def __exit__(self, *a: object) -> bool:
            return False

        def executemany(self, sql: str, rows: list[tuple[object, ...]]) -> None:
            self.calls.append((sql, list(rows)))

    class Conn:
        def __init__(self) -> None:
            self.cur = Cur()

        def cursor(self) -> Cur:
            return self.cur

    conn = Conn()
    rows = c.DayRows(
        sealed=[(9, DAY, 12000, None, None, None)],
        daily=[],
        top=[],
        skipped=0,
        cards=[(1, DAY, 1000, None, None, None)],
    )
    c.write_day(conn, rows)  # type: ignore[arg-type]
    price_rows = next(r for sql, r in conn.cur.calls if "INTO catalog_prices" in sql)
    assert {r[0] for r in price_rows} == {9, 1}


# ── write_day ──────────────────────────────────────────────────────────────


class FakeCursor:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[tuple[object, ...]]]] = []

    def executemany(self, sql: str, rows: list[tuple[object, ...]]) -> None:
        self.calls.append((sql, list(rows)))

    def __enter__(self) -> FakeCursor:
        return self

    def __exit__(self, *a: object) -> None:
        return None


class FakeConn:
    def __init__(self) -> None:
        self.cur = FakeCursor()

    def cursor(self) -> FakeCursor:
        return self.cur


def test_write_day_upserts_all_three_tables_with_the_rows_given() -> None:
    rows = c.DayRows(
        sealed=[(9, DAY, 1, 2, 3, 4)],
        daily=[(100, DAY, 1, 1, 10, 10, 10)],
        top=[(100, DAY, 1, 1, 10, "Normal")],
        skipped=0,
    )
    conn = FakeConn()
    c.write_day(conn, rows)  # type: ignore[arg-type]
    tables = [call[0].split("INTO")[1].split()[0] for call in conn.cur.calls]
    assert tables == ["catalog_prices", "catalog_set_daily", "catalog_set_top"]
    assert all("ON CONFLICT" in call[0] for call in conn.cur.calls)
    assert [call[1] for call in conn.cur.calls] == [rows.sealed, rows.daily, rows.top]


# ── downloading an archive ─────────────────────────────────────────────────


def client_with(handler: object) -> c.Client:
    import httpx

    return c.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]


def test_fetch_archive_ok_writes_the_file(tmp_path: Path, monkeypatch: object) -> None:
    import httpx

    monkeypatch.setattr(c.time, "sleep", lambda _s: None)  # type: ignore[attr-defined]
    cli = client_with(lambda req: httpx.Response(200, content=b"7z-bytes"))
    dest = tmp_path / "a.7z"
    assert cli.fetch_archive(DAY, dest) == "ok"
    assert dest.read_bytes() == b"7z-bytes"


def test_fetch_archive_404_is_missing_and_not_retried(tmp_path: Path, monkeypatch: object) -> None:
    import httpx

    monkeypatch.setattr(c.time, "sleep", lambda _s: None)  # type: ignore[attr-defined]
    hits = []

    def handler(req: httpx.Request) -> httpx.Response:
        hits.append(1)
        return httpx.Response(404)

    assert client_with(handler).fetch_archive(DAY, tmp_path / "a.7z") == "missing"
    assert len(hits) == 1


def test_fetch_archive_retries_server_errors_then_reports_error(
    tmp_path: Path, monkeypatch: object
) -> None:
    import httpx

    monkeypatch.setattr(c.time, "sleep", lambda _s: None)  # type: ignore[attr-defined]
    hits = []

    def handler(req: httpx.Request) -> httpx.Response:
        hits.append(1)
        return httpx.Response(503)

    assert client_with(handler).fetch_archive(DAY, tmp_path / "a.7z", retries=3) == "error"
    assert len(hits) == 3


def test_fetch_archive_recovers_after_a_transient_failure(
    tmp_path: Path, monkeypatch: object
) -> None:
    import httpx

    monkeypatch.setattr(c.time, "sleep", lambda _s: None)  # type: ignore[attr-defined]
    answers = iter([httpx.Response(503), httpx.Response(200, content=b"ok")])
    assert client_with(lambda req: next(answers)).fetch_archive(DAY, tmp_path / "a.7z") == "ok"


def test_compute_day_follows_products_that_moved_between_sets() -> None:
    # Today product 9 (sealed) and card 2 belong to set 100, but this old
    # archive lists their prices under set 200's file.
    known = {100: {1: "card", 2: "card", 9: "sealed"}, 200: {5: "card"}}
    archive = {
        (3, 100): results((1, "Normal", 10.0)),
        (3, 200): results((5, "Normal", 3.0), (2, "Normal", 40.0), (9, "Normal", 77.0)),
    }
    out = c.compute_day(
        day=DAY, archive=archive, known=known, set_ids={100, 200}, wants_top=lambda _g: False
    )
    assert out.sealed == [(9, DAY, 7700, None, None, None)]
    by_set = {r[0]: r for r in out.daily}
    assert by_set[100][4] == 5000  # cards 1 (10.00) + 2 (40.00): card 2 counts where it lives now
    assert by_set[200][4] == 300


def test_compute_day_lists_each_sealed_product_once() -> None:
    known = {100: {9: "sealed"}}
    archive = {(3, 100): results((9, "Normal", 5.0))}
    out = c.compute_day(
        day=DAY, archive=archive, known=known, set_ids={100}, wants_top=lambda _g: False
    )
    assert len(out.sealed) == 1


# ── being told to slow down ────────────────────────────────────────────────


def test_retry_after_uses_the_servers_number_but_caps_it() -> None:
    assert c.retry_after_seconds("20", 0) == 20.0
    assert c.retry_after_seconds(" 45 ", 3) == 45.0
    assert c.retry_after_seconds("99999", 0) == 180.0


def test_retry_after_grows_with_each_attempt_when_the_server_gives_no_number() -> None:
    assert [c.retry_after_seconds(None, a) for a in range(3)] == [15.0, 30.0, 45.0]
    assert c.retry_after_seconds("Wed, 21 Oct 2026 07:28:00 GMT", 1) == 30.0  # a date, not seconds
    assert c.retry_after_seconds(None, 50) == 180.0


def test_fetch_archive_waits_as_told_after_a_429_then_succeeds(tmp_path: Path) -> None:
    import httpx

    waits: list[float] = []
    answers = iter(
        [httpx.Response(429, headers={"Retry-After": "7"}), httpx.Response(200, content=b"ok")]
    )
    cli = client_with(lambda req: next(answers))
    original = c.time.sleep
    c.time.sleep = waits.append  # type: ignore[assignment]
    try:
        assert cli.fetch_archive(DAY, tmp_path / "a.7z") == "ok"
    finally:
        c.time.sleep = original  # type: ignore[assignment]
    assert waits == [7.0]


def test_fetch_archive_gives_up_after_repeated_429s_without_hammering(tmp_path: Path) -> None:
    import httpx

    waits: list[float] = []
    hits: list[int] = []

    def handler(req: httpx.Request) -> httpx.Response:
        hits.append(1)
        return httpx.Response(429)

    cli = client_with(handler)
    original = c.time.sleep
    c.time.sleep = waits.append  # type: ignore[assignment]
    try:
        assert cli.fetch_archive(DAY, tmp_path / "a.7z", retries=3) == "error"
    finally:
        c.time.sleep = original  # type: ignore[assignment]
    assert len(hits) == 3
    assert waits == [15.0, 30.0, 45.0]
