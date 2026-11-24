from datetime import UTC, datetime, timedelta

from poke_pipeline import weekly_digest as w
from poke_pipeline.replay import Tx

NOW = datetime(2026, 11, 24, 12, 0, tzinfo=UTC)


def day(n: float) -> datetime:
    """A moment n days before NOW."""
    return NOW - timedelta(days=n)


_n = 0


def tx(kind, ago, qty, value, **kw) -> Tx:
    global _n
    _n += 1
    return Tx(id=f"t{_n}", type=kind, quantity=qty, value_minor=value, at=day(ago), **kw)


def item(name, txs, prices=(), **kw) -> w.ItemData:
    return w.ItemData(
        id=name, name=name, currency=kw.pop("currency", "VND"),
        txs=list(txs), prices=list(prices), **kw,
    )


def price(ago, cents, cur="VND") -> w.Price:
    return w.Price(day(ago), cents, cur)


def inputs(items, **kw) -> w.Inputs:
    return w.Inputs(items=items, now=NOW, display="VND", usd_to={"USD": 1.0, "VND": 25000.0, "EUR": 0.9}, **kw)


# ── money ───────────────────────────────────────────────────────────────────


def test_convert_same_currency_and_via_usd():
    rates = {"VND": 25000.0, "EUR": 0.9}
    assert w.convert(500, "VND", "VND", rates) == 500
    assert w.convert(100, "USD", "VND", rates) == 25000  # $1 -> 25,000 VND
    assert w.convert(25000, "VND", "USD", rates) == 100  # back to cents
    assert w.convert(100, "EUR", "VND", rates) == round(1 / 0.9 * 25000)


def test_convert_without_a_rate_is_none():
    assert w.convert(100, "GBP", "VND", {"VND": 25000.0}) is None
    assert w.convert(100, "VND", "GBP", {"VND": 25000.0}) is None
    assert w.convert(100, "VND", "GBP", {"VND": 25000.0, "GBP": 0}) is None


def test_compact_money():
    assert w.compact_money(1_742_434_192, "VND") == "₫1.74B"
    assert w.compact_money(12_400_000, "VND") == "₫12.4M"
    assert w.compact_money(5000, "VND") == "₫5,000"
    assert w.compact_money(-7_200_000, "VND", signed=True) == "−₫7.2M"  # noqa: RUF001
    assert w.compact_money(3_100_000, "VND", signed=True) == "+₫3.1M"
    assert w.compact_money(1230, "USD") == "$12.30"
    assert w.compact_money(0, "VND", signed=True) == "₫0"


def test_price_at_takes_the_latest_on_or_before():
    ps = [price(10, 1), price(5, 2), price(1, 3)]
    assert w.price_at(ps, day(6)).cents == 1
    assert w.price_at(ps, day(5)).cents == 2
    assert w.price_at(ps, day(0)).cents == 3
    assert w.price_at(ps, day(20)) is None
    assert w.price_at([], day(1)) is None


# ── the numbers ─────────────────────────────────────────────────────────────


def test_value_now_and_a_week_ago():
    a = item("A", [tx("buy", 30, 2, 200)], [price(30, 100), price(10, 150), price(1, 200)])
    d = w.compute(inputs([a]))
    assert d.value_now == 2 * 200
    assert d.value_then == 2 * 150
    assert (d.held_now, d.priced_now) == (1, 1)


def test_buying_moves_the_headline_but_not_the_price_effect():
    # One unit held a week ago; a second bought since. The price did not move.
    a = item("A", [tx("buy", 30, 1, 100), tx("buy", 2, 1, 100)], [price(30, 100), price(1, 100)])
    d = w.compute(inputs([a]))
    assert d.value_now == 200 and d.value_then == 100
    assert d.kept_effect == 0 and d.kept_items == 1


def test_price_effect_is_on_the_units_kept_only():
    # Two held a week ago, one sold since: only the one kept feels the price.
    a = item("A", [tx("buy", 30, 2, 200), tx("sell", 3, 1, 150)], [price(30, 100), price(1, 130)])
    d = w.compute(inputs([a]))
    assert d.kept_effect == 1 * (130 - 100)
    assert d.kept_base == 100
    assert d.kept_pct == 0.3


def test_items_without_a_price_both_times_are_left_out_of_the_effect():
    a = item("A", [tx("buy", 30, 1, 100)], [price(1, 100)])  # no price a week ago
    d = w.compute(inputs([a]))
    assert d.kept_items == 0 and d.value_then == 0 and d.value_now == 100


def test_movers_are_ranked_and_split():
    items = [
        item("Up big", [tx("buy", 30, 1, 1)], [price(30, 100), price(1, 300)]),
        item("Up small", [tx("buy", 30, 1, 1)], [price(30, 100), price(1, 110)]),
        item("Down", [tx("buy", 30, 1, 1)], [price(30, 100), price(1, 40)]),
        item("Flat", [tx("buy", 30, 1, 1)], [price(30, 100), price(1, 100)]),
    ]
    d = w.compute(inputs(items))
    assert [m.name for m in d.gainers] == ["Up big", "Up small"]
    assert [m.name for m in d.losers] == ["Down"]
    assert d.gainers[0].pct == 2.0


def test_sales_this_week_year_to_date_and_write_offs():
    a = item(
        "A",
        [
            tx("buy", 100, 4, 400),
            tx("sell", 3, 1, 250),                        # this week: profit 150
            tx("sell", 40, 1, 150),                       # earlier this year: profit 50
            tx("sell", 2, 1, 0, exit_reason="gifted"),    # write-off: -100
        ],
    )
    d = w.compute(inputs([a]))
    assert (d.sales, d.units_sold, d.proceeds, d.cost_of_sales) == (1, 1, 250, 100)
    assert d.write_offs == 1
    assert d.ytd_net == 150 + 50 - 100


def test_last_years_sales_are_not_this_years():
    old = NOW.replace(year=2025, month=6)
    a = item("A", [Tx("b", "buy", 1, 100, old), Tx("s", "sell", 1, 500, old + timedelta(days=1))])
    assert w.compute(inputs([a])).ytd_net == 0


def test_spending_counts_pending_orders_too():
    a = item("A", [tx("buy", 2, 1, 700, status="pending"), tx("buy", 20, 1, 100)])
    d = w.compute(inputs([a]))
    assert (d.buys, d.spent) == (1, 700)


def test_sell_target_reached_only_for_held_items_in_the_same_currency():
    hit = item("Hit", [tx("buy", 30, 1, 1)], [price(1, 500)], sell_target=(500, "VND"))
    miss = item("Miss", [tx("buy", 30, 1, 1)], [price(1, 499)], sell_target=(500, "VND"))
    sold = item("Sold", [tx("buy", 30, 1, 1), tx("sell", 2, 1, 9)], [price(1, 900)], sell_target=(500, "VND"))
    other = item("Other", [tx("buy", 30, 1, 1)], [price(1, 900, "USD")], sell_target=(500, "VND"))
    d = w.compute(inputs([hit, miss, sold, other]))
    assert d.sell_targets == ["Hit"]


def test_overdue_orders_and_slips_and_backup():
    d = w.compute(
        inputs(
            [item("A", [tx("sell", 40, 1, 0), tx("buy", 100, 1, 5), tx("buy", -3, 1, 5)])],
            pending_buys=[("A", 3, day(20)), ("B", 2, day(5))],
            last_backup_at=day(45),
        )
    )
    assert (d.overdue_units, d.overdue_orders, d.overdue_oldest_days) == (3, 1, 20)
    assert d.future_dated == 1
    assert d.backup_days == 45


def test_a_missing_exchange_rate_leaves_the_item_out_and_says_so():
    a = item("A", [tx("buy", 30, 1, 100)], [price(1, 100, "GBP")], currency="GBP")
    d = w.compute(inputs([a]))
    assert d.value_now == 0 and d.unconverted == 1
    assert "left out: no exchange rate" in w.build_message(d)


def test_foreign_currency_items_are_converted():
    a = item("A", [tx("buy", 30, 1, 100, )], [price(1, 100, "USD")], currency="USD")
    d = w.compute(inputs([a]))
    assert d.value_now == 25000  # $1.00 at 25,000 VND per dollar


# ── the message ─────────────────────────────────────────────────────────────


def test_message_reads_well_for_a_normal_week():
    a = item(
        "Box",
        [tx("buy", 100, 4, 4_000_000), tx("sell", 3, 1, 2_500_000)],
        [price(30, 1_000_000), price(1, 1_100_000)],
    )
    m = w.build_message(w.compute(inputs([a], last_backup_at=day(2))))
    assert m.startswith("📅 *Weekly summary* · Nov 17 – Nov 24")  # noqa: RUF001
    assert "at market (1 of 1 items priced)" in m
    assert "1 sale brought in ₫2.5M, profit +₫1.5M" in m
    assert "Worth a look" not in m  # nothing to flag, so no section
    assert m.rstrip().endswith("aren't a forecast._")


def test_a_quiet_week_still_says_so():
    a = item("Box", [tx("buy", 100, 1, 1_000_000)], [price(30, 1_000_000), price(1, 1_000_000)])
    m = w.build_message(w.compute(inputs([a], last_backup_at=day(1))))
    assert "no sales" in m and "nothing bought" in m


def test_nothing_held():
    m = w.build_message(w.compute(inputs([])))
    assert "nothing held right now" in m


def test_flags_appear_with_singular_and_plural_wording():
    a = item("A", [tx("buy", 100, 1, 5), tx("sell", 40, 1, 0)])
    m = w.build_message(w.compute(inputs([a], pending_buys=[("A", 1, day(30))])))
    assert "1 sale for nothing not marked gifted or lost" in m
    assert "1 unit on the way for 14+ days (oldest 30d)" in m
    assert "No backup of your data yet" in m


def test_stale_backup_is_flagged_only_when_old():
    a = item("A", [tx("buy", 100, 1, 5)])
    assert "Last backup" not in w.build_message(w.compute(inputs([a], last_backup_at=day(29))))
    assert "Last backup was 31 days ago" in w.build_message(w.compute(inputs([a], last_backup_at=day(31))))


def test_message_always_fits_a_chat_message():
    # Many movers with very long names, many flags: still under the limit.
    long = "Extremely Long Product Name " * 6
    items = [
        item(f"{long}{i}", [tx("buy", 30, 1, 1), tx("sell", 40, 1, 0)], [price(30, 100), price(1, 100 + (i + 1) * 7 * (-1) ** i)],
             sell_target=(1, "VND"))
        for i in range(12)
    ]
    m = w.build_message(w.compute(inputs(items, pending_buys=[("A", 9, day(99))])))
    assert len(m) <= w.MAX_MESSAGE_CHARS


def test_names_are_trimmed_with_a_count():
    assert w._names(["a", "b", "c", "d", "e"]) == "a, b, c +2 more"
    assert w._names(["a"]) == "a"


def test_dry_run_prints_and_posts_nothing(monkeypatch, capsys):
    posted = []
    monkeypatch.setattr(w, "_post", lambda *a: posted.append(a) or True)
    monkeypatch.setattr(w, "fetch_inputs", lambda conn, now: inputs([]))

    class Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(w, "connection", lambda: Conn())
    r = w.run(dry_run=True, webhook_url="http://example.invalid", now=NOW)
    assert not posted and not r.posted
    assert "Weekly summary" in capsys.readouterr().out


def test_without_a_webhook_nothing_is_sent(monkeypatch):
    posted = []
    monkeypatch.setattr(w, "_post", lambda *a: posted.append(a) or True)
    monkeypatch.setattr(w, "fetch_inputs", lambda conn, now: inputs([]))

    class Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(w, "connection", lambda: Conn())
    monkeypatch.setattr(w, "load_settings", lambda: type("S", (), {"alert_webhook_url": None})())
    r = w.run(now=NOW)
    assert not posted and not r.posted


def test_a_failed_post_reports_not_posted(monkeypatch):
    monkeypatch.setattr(w, "_post", lambda *a: False)
    monkeypatch.setattr(w, "fetch_inputs", lambda conn, now: inputs([]))

    class Conn:
        def __enter__(self): return self
        def __exit__(self, *a): return False

    monkeypatch.setattr(w, "connection", lambda: Conn())
    assert w.run(webhook_url="http://example.invalid", now=NOW).posted is False
