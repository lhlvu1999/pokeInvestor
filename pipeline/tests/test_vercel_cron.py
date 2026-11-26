"""The Vercel entry point (api/cron.py): who may call it, and which phases run."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from threading import Thread

import pytest

_PATH = Path(__file__).resolve().parents[1] / "api" / "cron.py"
_spec = importlib.util.spec_from_file_location("vercel_cron", _PATH)
assert _spec and _spec.loader
cron = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cron)


def test_authorised_needs_the_exact_bearer_token() -> None:
    assert cron.authorised("Bearer s3cret-value", "s3cret-value")
    assert cron.authorised("bearer s3cret-value", "s3cret-value")
    assert not cron.authorised("Bearer wrong", "s3cret-value")
    assert not cron.authorised("s3cret-value", "s3cret-value")  # no scheme
    assert not cron.authorised("Basic s3cret-value", "s3cret-value")
    assert not cron.authorised("Bearer ", "s3cret-value")
    assert not cron.authorised(None, "s3cret-value")


def test_authorised_refuses_everything_when_no_secret_is_set() -> None:
    assert not cron.authorised("Bearer anything", None)
    assert not cron.authorised("Bearer ", "")
    assert not cron.authorised("Bearer x", "")


@pytest.mark.parametrize(
    ("raw", "phase"),
    [
        ("/api/cron?phase=discover", "discover"),
        ("/api/cron/catalog-sync", "catalog-sync"),
        ("/api/cron/catalog-sync/", "catalog-sync"),
        ("/api/cron", ""),
        ("/api/cron?phase=insights&x=1", "insights"),
    ],
)
def test_phase_from_path_or_query(raw: str, phase: str) -> None:
    assert cron.phase_from(raw) == phase


def test_only_scheduled_phases_are_allowed() -> None:
    assert "catalog-sync" in cron.PHASES
    # not for a function: run by the app's own schedule, or by a person
    for name in ("refresh-prices", "all", "catalog-backfill", "catalog-link-stock", "replay"):
        assert name not in cron.PHASES


def test_every_allowed_phase_is_a_real_cli_command() -> None:
    from poke_pipeline.cli import app

    names = {
        c.name or c.callback.__name__.removeprefix("cmd_").replace("_", "-")
        for c in app.registered_commands
        if c.callback
    }
    assert names >= cron.PHASES


def _call(
    monkeypatch: pytest.MonkeyPatch,
    secret: str | None,
    header: str | None,
    path: str,
    ran: list[str],
) -> tuple[int, dict[str, object]]:
    """Serve one request through the real handler on a loopback socket."""
    from http.client import HTTPConnection
    from http.server import HTTPServer

    if secret is None:
        monkeypatch.delenv("CRON_SECRET", raising=False)
    else:
        monkeypatch.setenv("CRON_SECRET", secret)
    monkeypatch.setattr(cron, "run_phase", lambda p: (ran.append(p), 0)[1])

    server = HTTPServer(("127.0.0.1", 0), cron.handler)
    t = Thread(target=server.handle_request)
    t.start()
    try:
        conn = HTTPConnection("127.0.0.1", server.server_port, timeout=10)
        headers = {"Authorization": header} if header else {}
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        body = json.loads(resp.read())
        return resp.status, body
    finally:
        t.join()
        server.server_close()


def test_handler_runs_an_authorised_known_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[str] = []
    status, body = _call(monkeypatch, "tok", "Bearer tok", "/api/cron?phase=discover", ran)
    assert status == 200 and body["ok"] is True and ran == ["discover"]


def test_handler_refuses_without_secret_or_token(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[str] = []
    assert _call(monkeypatch, None, "Bearer tok", "/api/cron?phase=discover", ran)[0] == 503
    assert _call(monkeypatch, "tok", None, "/api/cron?phase=discover", ran)[0] == 401
    assert _call(monkeypatch, "tok", "Bearer nope", "/api/cron?phase=discover", ran)[0] == 401
    assert ran == []


def test_handler_404s_unknown_phase(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[str] = []
    status, _ = _call(monkeypatch, "tok", "Bearer tok", "/api/cron?phase=drop-tables", ran)
    assert status == 404 and ran == []


def test_a_failing_phase_is_reported_as_500(monkeypatch: pytest.MonkeyPatch) -> None:
    from http.client import HTTPConnection
    from http.server import HTTPServer

    monkeypatch.setenv("CRON_SECRET", "tok")
    monkeypatch.setattr(cron, "run_phase", lambda p: 1)
    server = HTTPServer(("127.0.0.1", 0), cron.handler)
    t = Thread(target=server.handle_request)
    t.start()
    try:
        conn = HTTPConnection("127.0.0.1", server.server_port, timeout=10)
        conn.request("GET", "/api/cron?phase=insights", headers={"Authorization": "Bearer tok"})
        resp = conn.getresponse()
        assert resp.status == 500 and json.loads(resp.read())["ok"] is False
    finally:
        t.join()
        server.server_close()
