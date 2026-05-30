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

from poke_pipeline import discover, extract, transcripts
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
def cmd_transcripts() -> None:
    """Fetch transcripts for any videos that don't have one yet."""
    try:
        result = transcripts.run()
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
    """Run discover → transcripts → insights sequentially."""
    try:
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
