"""Typer CLI entrypoint.

Subcommands mirror the pipeline phases. Each is idempotent — re-running
only does the work that's missing. The `all` subcommand runs them in
order so the local-dev workflow is a single command.

In production each phase runs as its own Argo CronWorkflow — see
`pipeline/deploy/argo/`.
"""

from __future__ import annotations

import logging
import sys

import typer

from poke_pipeline import (
    backfill,
    catalog,
    catalog_images,
    catalog_link,
    discover,
    extract,
    floor_alerts,
    price_refresh,
    sell_alerts,
    stage_alerts,
    transcripts,
    watchlist_alerts,
    weekly_digest,
)
from poke_pipeline.db import close_pool

app = typer.Typer(
    add_completion=False,
    help="Pokémon-investor YouTube pipeline.",
    no_args_is_help=True,
)


def _configure_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s · %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


@app.callback()
def main(verbose: bool = typer.Option(False, "--verbose", "-v")) -> None:
    """Common flags for every subcommand."""
    _configure_logging(verbose)


@app.command("backfill")
def cmd_backfill() -> None:
    """One-shot historical fetch (via yt-dlp) for sources that haven't been
    backfilled yet. Safe to re-run — already-backfilled sources are skipped.
    """
    try:
        result = backfill.run()
        typer.echo(
            f"backfill: {result.sources_processed} processed, "
            f"{result.sources_failed} failed, "
            f"{result.videos_added} new video(s)"
        )
    finally:
        close_pool()


@app.command("discover")
def cmd_discover() -> None:
    """Fetch the latest videos from every active channel source."""
    try:
        result = discover.run()
        typer.echo(
            f"discover: {result.sources_checked} source(s) checked, "
            f"{result.videos_added} new video(s)"
        )
    finally:
        close_pool()


@app.command("transcripts")
def cmd_transcripts(
    retry_errors: bool = typer.Option(
        False,
        "--retry-errors",
        help=(
            "Also re-fetch videos previously recorded with status='error' "
            "(e.g. rate-limit / IP-block failures). Wait for the block to "
            "expire before using — usually hours. Rows with status='missing' "
            "are NEVER retried — YouTube has confirmed captions are disabled."
        ),
    ),
    test: str | None = typer.Option(
        None,
        "--test",
        metavar="VIDEO_ID",
        help=(
            "Diagnostic: try fetching a single video's transcript with the "
            "current cookies/proxy config and print the result. Doesn't "
            "touch the DB. Use to verify an IP-block has lifted (or that "
            "your cookies / proxy work) before running the full batch."
        ),
    ),
    method: str | None = typer.Option(
        None,
        "--method",
        metavar="ENGINE",
        help=(
            "Override TRANSCRIPT_METHOD for this run: 'youtube_captions' "
            "(scrape, IP-block prone) or 'whisper' (local audio + faster-"
            "whisper). Use with --test to compare engines on the same video."
        ),
    ),
) -> None:
    """Fetch transcripts for any videos that don't have one yet."""
    from poke_pipeline import whisper_transcribe
    from poke_pipeline.config import load_settings

    try:
        if test is not None:
            settings = load_settings()
            engine = (method or settings.transcript_method).lower()
            if engine == "whisper":
                status, payload = whisper_transcribe.transcribe(test, settings)
            else:
                api = transcripts.build_api()
                status, payload = transcripts._fetch_one(api, test)
            typer.echo(f"video_id: {test}")
            typer.echo(f"method:   {engine}")
            typer.echo(f"status:   {status}")
            if status == "ok":
                length = len(payload.get("text") or "")
                lang = payload.get("language")
                typer.echo(f"language: {lang}")
                typer.echo(f"length:   {length} chars")
            else:
                err = payload.get("error_msg") or ""
                typer.echo(f"error:    {err[:200]}")
            return
        result = transcripts.run(retry_errors=retry_errors, method_override=method)
        typer.echo(
            f"transcripts: {result.fetched} fetched, "
            f"{result.missing} missing, {result.errored} errored"
        )
    finally:
        close_pool()


@app.command("insights")
def cmd_insights() -> None:
    """Run the LLM extraction on transcripts that haven't been processed
    with the currently-active prompt.
    """
    try:
        result = extract.run()
        typer.echo(
            f"insights: {result.processed} processed, "
            f"{result.skipped} skipped, {result.errored} errored"
        )
    finally:
        close_pool()


@app.command("watchlist-alerts")
def cmd_watchlist_alerts(
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be sent; post nothing and change nothing.",
    ),
    stage: bool = typer.Option(
        True,
        "--stage/--no-stage",
        help="Also run the opt-in 'usual low point' alerts (see stage-alerts).",
    ),
    sell: bool = typer.Option(
        True,
        "--sell/--no-sell",
        help="Also run the sell-target alerts (see sell-alerts).",
    ),
    floor: bool = typer.Option(
        True,
        "--floor/--no-floor",
        help="Also run the price-floor alerts (see floor-alerts).",
    ),
) -> None:
    """Alert (via ALERT_WEBHOOK_URL) when a watchlist item's market price
    reaches its buy target. One alert per crossing; re-arms when the price
    climbs back above target. Also sends the opt-in "usual low point" alerts
    (--no-stage to skip them), the sell-target alerts for items you hold
    (--no-sell to skip them) and the price-floor alerts (--no-floor to skip
    them). Run it daily.
    """
    try:
        r = watchlist_alerts.run(dry_run=dry_run)
        typer.echo(
            f"watchlist-alerts: {r.checked} checked, {r.alerted} alerted, "
            f"{r.rearmed} re-armed, {r.skipped} skipped (currency mismatch)"
        )
        if stage:
            s = stage_alerts.run(dry_run=dry_run)
            typer.echo(
                f"stage-alerts: {s.checked} checked, {s.alerted} alerted, "
                f"{s.skipped} skipped (no age, kind or usual low)"
            )
        if sell:
            x = sell_alerts.run(dry_run=dry_run)
            typer.echo(
                f"sell-alerts: {x.checked} checked, {x.alerted} alerted, "
                f"{x.rearmed} re-armed, {x.skipped} skipped (nothing held, or currency mismatch)"
            )
        if floor:
            f = floor_alerts.run(dry_run=dry_run)
            typer.echo(
                f"floor-alerts: {f.checked} checked, {f.alerted} alerted, "
                f"{f.rearmed} re-armed, {f.skipped} skipped (nothing held, or currency mismatch)"
            )
    finally:
        close_pool()


@app.command("floor-alerts")
def cmd_floor_alerts(
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be sent; post nothing and change nothing.",
    ),
) -> None:
    """Alert (via ALERT_WEBHOOK_URL) when an item you hold falls to or below the
    price floor set on its page. One alert per crossing; re-arms when the price
    climbs back above the floor. A heads-up about a price you chose to watch, not
    a recommendation; market prices are estimates.
    """
    try:
        f = floor_alerts.run(dry_run=dry_run)
        typer.echo(
            f"floor-alerts: {f.checked} checked, {f.alerted} alerted, "
            f"{f.rearmed} re-armed, {f.skipped} skipped (nothing held, or currency mismatch)"
        )
    finally:
        close_pool()


@app.command("weekly-digest")
def cmd_weekly_digest(
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print the message; post nothing.",
    ),
) -> None:
    """Post a weekly summary (via ALERT_WEBHOOK_URL): what the stock is worth and
    how prices moved it, the week's sales and spending, and anything worth a
    look. Read-only: it writes nothing to the database. Run it once a week.
    """
    try:
        r = weekly_digest.run(dry_run=dry_run)
        if not dry_run:
            typer.echo(f"weekly-digest: {'posted' if r.posted else 'not posted'}")
    finally:
        close_pool()


@app.command("refresh-prices")
def cmd_refresh_prices() -> None:
    """Ask the web app (APP_URL, with CRON_TOKEN) to refresh market prices for the
    items you hold, the way its "Update all prices" button does. Run it daily,
    before the alerts. Exits non-zero if the refresh failed or gave up.
    """
    try:
        r = price_refresh.run()
    except price_refresh.ConfigError as e:
        typer.echo(f"refresh-prices: {e}", err=True)
        raise typer.Exit(2) from e
    typer.echo(r.message)
    for p in r.body.get("problems", []):
        typer.echo(f"  {p.get('status')}: {p.get('name')}" + (f" ({p['message']})" if p.get("message") else ""))
    if not r.ok:
        raise typer.Exit(1)


@app.command("sell-alerts")
def cmd_sell_alerts(
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be sent; post nothing and change nothing.",
    ),
) -> None:
    """Alert (via ALERT_WEBHOOK_URL) when an item you hold reaches the sell
    target set on its page. One alert per crossing; re-arms when the price
    falls back below target. Market prices are estimates.
    """
    try:
        x = sell_alerts.run(dry_run=dry_run)
        typer.echo(
            f"sell-alerts: {x.checked} checked, {x.alerted} alerted, "
            f"{x.rearmed} re-armed, {x.skipped} skipped (nothing held, or currency mismatch)"
        )
    finally:
        close_pool()


@app.command("stage-alerts")
def cmd_stage_alerts(
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be sent; post nothing and change nothing.",
    ),
) -> None:
    """Alert (via ALERT_WEBHOOK_URL) when a watched product, opted in on the
    watchlist page, reaches the age at which earlier launches of its kind have
    typically been at their lowest price. One alert per product; describes past
    launches and is not a recommendation.
    """
    try:
        s = stage_alerts.run(dry_run=dry_run)
        typer.echo(
            f"stage-alerts: {s.checked} checked, {s.alerted} alerted, "
            f"{s.skipped} skipped (no age, kind or usual low)"
        )
    finally:
        close_pool()


@app.command("catalog-sync")
def cmd_catalog_sync(
    day: str = typer.Option(
        "",
        "--day",
        help="Price archive day (YYYY-MM-DD). Default: the newest one published.",
    ),
    max_sets: int = typer.Option(
        catalog.DEFAULT_MAX_SETS,
        "--max-sets",
        help="Most set product-lists to read this run (a first run needs ~690).",
    ),
    link: bool = typer.Option(
        True,
        "--link/--no-link",
        help="Afterwards, link clear matches among the items you hold and fill images.",
    ),
) -> None:
    """Sync English + Japanese Pokémon sets, sealed products and set totals
    from the TCGCSV mirror of TCGplayer, then link the items you hold to
    their catalogue products. Run it daily after 20:00 UTC.
    """
    from datetime import date as _date

    try:
        r = catalog.run(
            day=_date.fromisoformat(day) if day else None,
            max_sets=max_sets,
        )
        typer.echo(
            f"catalog-sync {r.day}: {r.sets} sets ({r.sets_fetched} product lists read), "
            f"{r.sealed_prices} sealed prices, {r.set_rows} set totals, "
            f"{r.top_rows} top-card rows"
            + (f", {r.skipped_sets} sets skipped (no products yet)" if r.skipped_sets else "")
        )
        if link:
            _echo_link_result(catalog_link.link_stock())
            _echo_fill_result(catalog_images.fill_images())
            _echo_slab_result(catalog_images.link_slabs())
    finally:
        close_pool()


def _echo_link_result(r: catalog_link.LinkResult) -> None:
    typer.echo(
        f"catalog-link: {len(r.linked)} of {r.considered} held items linked automatically, "
        f"{r.left_for_review} left for you to review, {r.images_filled} images filled"
    )


def _echo_fill_result(r: catalog_images.FillResult) -> None:
    typer.echo(
        f"catalog-images: {len(r.sealed)} sealed and {len(r.slabs)} slab pictures filled, "
        f"{r.left} items still without one"
    )


def _echo_slab_result(r: catalog_images.SlabLinkResult) -> None:
    typer.echo(f"catalog-slabs: {len(r.linked)} of {r.considered} unmatched slabs matched to a card")


@app.command("catalog-link-slabs")
def cmd_catalog_link_slabs(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="List the matches; change nothing."
    ),
) -> None:
    """Match graded slabs to the catalogue card they are (by card number,
    language and name; only a single clear match) so the card's raw price is
    kept by catalog-sync. Never touches a slab you marked as wrongly matched.
    """
    try:
        r = catalog_images.link_slabs(dry_run=dry_run)
        if dry_run:
            for item, card in r.linked:
                typer.echo(f"  {item}  ->  {card}")
        _echo_slab_result(r)
    finally:
        close_pool()


@app.command("catalog-link-stock")
def cmd_catalog_link_stock(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="List what would be linked; change nothing."
    ),
) -> None:
    """Link the items you currently hold to catalogue products (clear matches
    only) and fill missing images, without re-syncing prices. Never overrides a
    link, skip or unlink you made yourself.
    """
    try:
        r = catalog_link.link_stock(dry_run=dry_run)
        if dry_run:
            for item, product in r.linked:
                typer.echo(f"  would link  {item}  ->  {product}")
        _echo_link_result(r)
    finally:
        close_pool()


@app.command("catalog-fill-images")
def cmd_catalog_fill_images(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="List what would be filled; change nothing."
    ),
) -> None:
    """Fill missing item pictures from the catalogue without linking anything:
    sealed products you have sold, and graded slabs (matched by card number).
    Never replaces a picture that is already there.
    """
    try:
        r = catalog_images.fill_images(dry_run=dry_run)
        if dry_run:
            for item, product in r.sealed:
                typer.echo(f"  sealed  {item}  ->  {product}")
            for item, card in r.slabs:
                typer.echo(f"  slab    {item}  ->  {card}")
        typer.echo(
            f"catalog-fill-images: {len(r.sealed)} sealed and {len(r.slabs)} slab pictures "
            f"{'would be filled' if dry_run else 'filled'}, {r.left} items left for you to do by hand"
        )
    finally:
        close_pool()


@app.command("catalog-backfill")
def cmd_catalog_backfill(
    start: str = typer.Option(
        catalog.BACKFILL_FIRST_DAY.isoformat(),
        "--from",
        help="First day to load (YYYY-MM-DD). The archive starts 2024-02-08.",
    ),
    end: str = typer.Option("", "--to", help="Last day (YYYY-MM-DD). Default: yesterday."),
    oldest_first: bool = typer.Option(
        False, "--oldest-first", help="Load oldest days first (default: newest first)."
    ),
    limit: int = typer.Option(0, "--limit", help="Load at most this many days (0 = all)."),
    delay: float = typer.Option(
        2.0, "--delay", help="Seconds to wait between days; keep it polite."
    ),
) -> None:
    """Load TCGplayer price history from TCGCSV's daily archive.

    Resumable: days already stored are skipped, so you can stop it and run it
    again. Run `catalog-sync` first so the catalogue's products exist.
    """
    from datetime import date as _date

    try:
        r = catalog.backfill(
            start=_date.fromisoformat(start),
            end=_date.fromisoformat(end) if end else None,
            newest_first=not oldest_first,
            limit=limit or None,
            delay=delay,
        )
        typer.echo(
            f"catalog-backfill: {r.loaded} of {r.planned} days loaded "
            f"({r.sealed_rows} sealed prices, {r.set_rows} set totals, {r.top_rows} top-card rows)"
            + (f"; {len(r.missing)} days have no archive" if r.missing else "")
            + (f"; {len(r.failed)} failed, run again to retry" if r.failed else "")
        )
    finally:
        close_pool()


@app.command("all")
def cmd_all() -> None:
    """Run backfill → discover → transcripts → insights sequentially.

    Backfill runs first so any newly-added sources get history filled in
    before discover / transcripts pick up the new video IDs.
    """
    try:
        b = backfill.run()
        typer.echo(
            f"backfill: {b.sources_processed} processed, "
            f"{b.sources_failed} failed, {b.videos_added} new video(s)"
        )
        d = discover.run()
        typer.echo(
            f"discover: {d.sources_checked} source(s) checked, "
            f"{d.videos_added} new video(s)"
        )
        t = transcripts.run()
        typer.echo(
            f"transcripts: {t.fetched} fetched, "
            f"{t.missing} missing, {t.errored} errored"
        )
        i = extract.run()
        typer.echo(
            f"insights: {i.processed} processed, "
            f"{i.skipped} skipped, {i.errored} errored"
        )
    finally:
        close_pool()


if __name__ == "__main__":
    app()
