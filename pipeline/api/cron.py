"""Vercel entry point: runs ONE pipeline phase per request.

This is the Vercel counterpart of the Argo CronWorkflows in ``deploy/argo``.
A Vercel Schedule (see ``vercel.json``) calls ``/api/cron/<phase>``; the phase
name is exactly a ``poke-pipeline`` CLI command, and it is run in-process
through the same Typer app, so there is one implementation of every phase.

Safety
------
- The route is public on the internet, so every call must carry
  ``Authorization: Bearer <CRON_SECRET>``. Vercel adds that header by itself to
  scheduled calls when the project has a ``CRON_SECRET`` environment variable.
  With no secret set the route refuses everything (503) instead of opening up.
- Only the phases listed in ``PHASES`` can be run; anything else is a 404.
- Nothing from the request is passed to the command except the phase name.
"""

from __future__ import annotations

import hmac
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

# The package lives in ../src (it is not installed as a distribution here).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

# Functions are short-lived batch jobs, so they use the database's direct
# connection when there is one; the pooled one (PgBouncer) cannot reuse the
# prepared statements psycopg creates after a few repeats.
_direct = os.environ.get("DATABASE_URL_UNPOOLED")
if _direct:
    os.environ["DATABASE_URL"] = _direct

# Phases that make sense as a scheduled function. `refresh-prices` runs on the
# web app's own schedule, and `all`, the back-fill helpers and the one-off
# catalog tools are for a person at a terminal.
PHASES = frozenset(
    {
        "backfill",
        "discover",
        "transcripts",
        "insights",
        "watchlist-alerts",
        "weekly-digest",
        "catalog-sync",
    }
)


def authorised(header: str | None, secret: str | None) -> bool:
    """True when ``header`` is ``Bearer <secret>`` (constant-time compare)."""
    if not secret or not header:
        return False
    scheme, _, given = header.partition(" ")
    if scheme.lower() != "bearer" or not given:
        return False
    return hmac.compare_digest(given.strip().encode(), secret.encode())


def phase_from(raw_path: str) -> str:
    """The phase named by ``?phase=x`` or the last path segment (``/api/cron/x``)."""
    parts = urlsplit(raw_path)
    asked = parse_qs(parts.query).get("phase")
    if asked:
        return asked[0]
    tail = parts.path.rstrip("/").rsplit("/", 1)[-1]
    return "" if tail == "cron" else tail


def run_phase(phase: str) -> int:
    """Run one CLI phase in-process; return its exit code (0 = fine)."""
    from poke_pipeline.cli import app

    try:
        code = app(args=[phase], standalone_mode=False)
    except SystemExit as e:  # a command that calls sys.exit()
        code = e.code
    except Exception as e:
        print(f"phase {phase} failed: {type(e).__name__}: {e}", file=sys.stderr)
        return 1
    return code if isinstance(code, int) else 0


class handler(BaseHTTPRequestHandler):
    def _reply(self, status: int, body: dict[str, object]) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle(self) -> None:
        secret = os.environ.get("CRON_SECRET")
        if not secret:
            self._reply(503, {"error": "CRON_SECRET is not set; refusing to run."})
            return
        if not authorised(self.headers.get("Authorization"), secret):
            self._reply(401, {"error": "Missing or wrong token."})
            return
        phase = phase_from(self.path)
        if phase not in PHASES:
            self._reply(404, {"error": "Unknown phase.", "phases": sorted(PHASES)})
            return
        started = time.monotonic()
        code = run_phase(phase)
        self._reply(
            200 if code == 0 else 500,
            {"phase": phase, "ok": code == 0, "seconds": round(time.monotonic() - started, 1)},
        )

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()
