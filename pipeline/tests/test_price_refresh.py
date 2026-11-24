import httpx
import pytest

from poke_pipeline import price_refresh as pr

GOOD = {
    "ok": True, "considered": 10, "attempted": 10, "saved": 7, "skipped": 1,
    "noData": 1, "errors": 0, "cooldown": 1, "stopped": None, "problems": [],
}


def client(status: int, body: object, seen: list | None = None) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=False)


def test_endpoint_url_keeps_scheme_and_host_and_drops_any_path():
    assert pr.endpoint_url("http://localhost:3000") == "http://localhost:3000/api/cron/refresh-prices"
    assert pr.endpoint_url("https://pokes.example.com/some/path/") == "https://pokes.example.com/api/cron/refresh-prices"


@pytest.mark.parametrize("bad", ["", "localhost:3000", "ftp://x", "http://", "javascript:alert(1)"])
def test_endpoint_url_rejects_junk(bad):
    with pytest.raises(pr.ConfigError):
        pr.endpoint_url(bad)


def test_a_good_run_is_reported_and_succeeds():
    r = pr.run(app_url="http://localhost:3000", token="t" * 40, client=client(200, GOOD))
    assert r.ok and r.status == 200
    assert "7 priced" in r.message and "1 low-confidence" in r.message and "1 without listings" in r.message


def test_it_sends_the_token_as_a_bearer_header_and_never_follows_redirects():
    seen: list[httpx.Request] = []
    pr.run(app_url="http://localhost:3000", token="secret-token-" + "x" * 30, client=client(200, GOOD, seen))
    assert seen[0].method == "POST"
    assert seen[0].headers["authorization"] == "Bearer secret-token-" + "x" * 30
    assert str(seen[0].url) == "http://localhost:3000/api/cron/refresh-prices"
    # A redirect must not be followed: it would carry the token elsewhere.
    redirect = httpx.Client(
        transport=httpx.MockTransport(lambda req: httpx.Response(302, headers={"location": "http://evil.example/"})),
        follow_redirects=False,
    )
    r = pr.run(app_url="http://localhost:3000", token="t" * 40, client=redirect)
    assert not r.ok and r.status == 302


def test_the_token_never_appears_in_the_reported_message():
    tok = "super-secret-" + "z" * 30
    for status in (200, 401, 404, 429, 502, 503, 500):
        r = pr.run(app_url="http://localhost:3000", token=tok, client=client(status, {"error": "x", "ok": status == 200}))
        assert tok not in r.message


@pytest.mark.parametrize(
    "status,body,phrase",
    [
        (404, {"error": "Scheduled refresh is not set up"}, "no CRON_TOKEN"),
        (401, {"error": "Missing or wrong token."}, "refused the token"),
        (429, {"error": "Too many"}, "too many wrong tokens"),
        (409, {"error": "running"}, "already running"),
        (503, {"error": "eBay credentials missing."}, "eBay credentials missing"),
        (502, {"ok": False, "stopped": "failing", "firstError": "HTTP 401"}, "kept failing: HTTP 401"),
        (500, {"error": "boom"}, "unexpected reply (HTTP 500)"),
    ],
)
def test_every_failure_the_app_can_give_is_explained_and_not_ok(status, body, phrase):
    r = pr.run(app_url="http://localhost:3000", token="t" * 40, client=client(status, body))
    assert not r.ok and phrase in r.message


def test_a_run_that_stopped_early_is_still_ok_and_says_so():
    r = pr.run(app_url="http://localhost:3000", token="t" * 40, client=client(200, {**GOOD, "stopped": "budget"}))
    assert r.ok and "time budget" in r.message


def test_a_non_json_reply_is_reported_not_raised():
    c = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(502, text="<html>bad gateway</html>")))
    r = pr.run(app_url="http://localhost:3000", token="t" * 40, client=c)
    assert not r.ok and r.status == 502


def test_an_unreachable_app_is_reported_without_a_traceback_or_the_token():
    def boom(request):
        raise httpx.ConnectError("refused")

    c = httpx.Client(transport=httpx.MockTransport(boom))
    r = pr.run(app_url="http://localhost:3000", token="t" * 40, client=c)
    assert not r.ok and r.status is None and "could not reach the app" in r.message


def test_missing_settings_are_a_config_error(monkeypatch):
    monkeypatch.delenv("APP_URL", raising=False)
    monkeypatch.delenv("CRON_TOKEN", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgres://x")
    with pytest.raises(pr.ConfigError, match="APP_URL"):
        pr.run(client=client(200, GOOD))
    with pytest.raises(pr.ConfigError, match="CRON_TOKEN"):
        pr.run(app_url="http://localhost:3000", client=client(200, GOOD))


@pytest.mark.parametrize(
    "url,expected",
    [
        ("http://localhost:3000/x", False),
        ("http://192.168.1.5:3000/x", False),
        ("http://10.0.0.7/x", False),
        ("http://poke-investor:3000/x", False),
        ("http://poke.svc.cluster.local:3000/x", False),
        ("https://pokes.example.com/x", False),
        ("http://pokes.example.com/x", True),
        ("http://8.8.8.8/x", True),
    ],
)
def test_it_flags_a_token_sent_over_plain_http_to_a_public_address(url, expected):
    assert pr._plain_http_to_public_host(url) is expected
