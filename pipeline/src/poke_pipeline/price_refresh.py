"""Ask the web app to refresh market prices, on a schedule.

The app already knows how to price what you hold (the eBay estimate, the
one-hour cooldown, saving only medium- and high-confidence results, converting
currencies): it is what the "Update all prices" button runs. Rather than copy
that into Python and keep two estimators in step, this command makes one
authenticated call to the app and reports what came back.

The call is ``POST {APP_URL}/api/cron/refresh-prices`` with
``Authorization: Bearer {CRON_TOKEN}``; the app must have the same ``CRON_TOKEN``.

Care taken:
- The token is never logged, and redirects are never followed (a redirect would
  carry the token to wherever it points).
- An app without ``CRON_TOKEN`` answers 404 ("not set up"); that is reported as
  the configuration problem it is, not as a crash.
- Exit status is non-zero when the refresh failed or gave up (so a scheduler
  shows the run as failed), and zero when it finished, even if some items had no
  usable listings: that is normal.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlsplit

import httpx

from poke_pipeline.config import load_settings

log = logging.getLogger(__name__)

ENDPOINT = "/api/cron/refresh-prices"
TIMEOUT_SEC = 15 * 60.0
"""A full portfolio takes under a minute; this only guards against a hang."""


class ConfigError(Exception):
    """APP_URL or CRON_TOKEN is missing or unusable."""


@dataclass(frozen=True)
class Result:
    ok: bool
    status: int | None
    body: dict[str, Any]
    message: str
    """One line a person can act on."""


def endpoint_url(app_url: str) -> str:
    parts = urlsplit(app_url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise ConfigError(f"APP_URL must start with http:// or https:// (got {app_url!r}).")
    return f"{parts.scheme}://{parts.netloc}{ENDPOINT}"


def _plain_http_to_public_host(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if parts.scheme != "http":
        return False
    private = host in ("localhost", "::1") or host.endswith((".local", ".lan", ".internal", ".svc", ".cluster.local"))
    if private or "." not in host:
        return False
    octets = host.split(".")
    if len(octets) == 4 and all(o.isdigit() for o in octets):
        a, b = int(octets[0]), int(octets[1])
        return not (a in (10, 127) or (a == 192 and b == 168) or (a == 172 and 16 <= b <= 31))
    return True


def describe(status: int | None, body: dict[str, Any]) -> tuple[bool, str]:
    """(did it work, a one-line summary) from the app's reply."""
    if status == 200 and body.get("ok") is True:
        bits = [
            f"{body.get('saved', 0)} priced",
            f"{body.get('skipped', 0)} low-confidence (not saved)",
            f"{body.get('noData', 0)} without listings",
            f"{body.get('cooldown', 0)} priced recently",
            f"{body.get('errors', 0)} errors",
        ]
        tail = ""
        if body.get("stopped") == "budget":
            tail = "; stopped early (time budget), the rest next run"
        elif body.get("stopped") == "limit":
            tail = "; stopped at the item limit"
        return True, f"refresh-prices: {', '.join(bits)}{tail}"
    err = body.get("error") or "no explanation given"
    if status == 404:
        return False, "refresh-prices: the app has no CRON_TOKEN set, so scheduled refresh is off there"
    if status == 401:
        return False, "refresh-prices: the app refused the token (CRON_TOKEN differs between the two)"
    if status == 429:
        return False, f"refresh-prices: too many wrong tokens, the app is making this wait ({err})"
    if status == 409:
        return False, "refresh-prices: a refresh was already running"
    if status == 503:
        return False, f"refresh-prices: the app cannot refresh right now: {err}"
    if status == 502:
        return False, f"refresh-prices: gave up because pricing kept failing: {body.get('firstError') or err}"
    return False, f"refresh-prices: unexpected reply (HTTP {status}): {err}"


def run(*, app_url: str | None = None, token: str | None = None, client: httpx.Client | None = None) -> Result:
    settings = load_settings()
    url_in = app_url if app_url is not None else settings.app_url
    tok = token if token is not None else settings.cron_token
    if not url_in:
        raise ConfigError("APP_URL is not set (where the web app is, e.g. http://localhost:3000).")
    if not tok:
        raise ConfigError("CRON_TOKEN is not set (it must match the app's CRON_TOKEN).")
    url = endpoint_url(url_in)
    if _plain_http_to_public_host(url):
        log.warning("refresh-prices: sending the token over plain http to a public address; use https")

    own = client is None
    http = client or httpx.Client(timeout=TIMEOUT_SEC, follow_redirects=False)
    try:
        try:
            r = http.post(url, headers={"Authorization": f"Bearer {tok}"})
        except httpx.HTTPError as e:
            return Result(False, None, {}, f"refresh-prices: could not reach the app at {urlsplit(url).netloc} ({type(e).__name__})")
        try:
            body = r.json()
            if not isinstance(body, dict):
                body = {}
        except ValueError:
            body = {}
        ok, message = describe(r.status_code, body)
        return Result(ok, r.status_code, body, message)
    finally:
        if own:
            http.close()
