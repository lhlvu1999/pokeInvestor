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

from poke_pipeline import backfill, discover, extract, transcripts
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
) -> None:
    """Fetch transcripts for any videos that don't have one yet."""
    try:
        if test is not None:
            api = transcripts.build_api()
            status, payload = transcripts._fetch_one(api, test)
            typer.echo(f"video_id: {test}")
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
        result = transcripts.run(retry_errors=retry_errors)
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
