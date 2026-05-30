"""Override-logic tests for `config._parse_temperature_override` and
`load_settings()`. We don't touch the DB.
"""

from __future__ import annotations

import pytest

from poke_pipeline import config as config_mod
from poke_pipeline.config import Settings, load_settings

# All keys load_settings inspects. We clear them up-front in each test so
# whatever happens to be in the real `.env` (or the developer's shell)
# can't leak in and skew the assertions.
_KEYS = (
    "DATABASE_URL",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "PIPE_LLM_JSON_MODE",
    "LLM_MODEL",
    "LLM_TEMPERATURE",
    "PIPE_DISCOVER_MAX",
    "PIPE_INSIGHTS_BATCH",
    "PIPE_HTTP_TIMEOUT_SEC",
    "YT_TRANSCRIPT_COOKIES",
    "YT_TRANSCRIPT_PROXY",
)


@pytest.fixture
def settings(monkeypatch: pytest.MonkeyPatch):
    """Factory: build a Settings with only the env you supply, isolated from
    the developer's shell and the repo's real `.env`.
    """

    def _make(**env: str) -> Settings:
        for k in _KEYS:
            monkeypatch.delenv(k, raising=False)
        # DATABASE_URL is required — give it a placeholder.
        monkeypatch.setenv("DATABASE_URL", "postgres://x:x@localhost/x")
        for k, v in env.items():
            monkeypatch.setenv(k, v)
        return load_settings()

    return _make


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (None, (None, False)),
        ("", (None, False)),
        ("   ", (None, False)),
        ("0", (0.0, False)),
        ("0.7", (0.7, False)),
        ("1.5", (1.5, False)),
        ("null", (None, True)),
        ("NULL", (None, True)),
        ("Null", (None, True)),
        ("not-a-number", (None, False)),
    ],
)
def test_parse_temperature_override(
    raw: str | None, expected: tuple[float | None, bool]
) -> None:
    assert config_mod._parse_temperature_override(raw) == expected


def test_no_overrides_means_no_env_values(settings) -> None:
    s = settings()
    assert s.llm_model_override is None
    assert s.llm_temperature_override is None
    assert s.llm_temperature_force_null is False
    assert s.openai_base_url is None
    assert s.llm_json_mode is False


def test_model_override(settings) -> None:
    s = settings(LLM_MODEL="qwen2.5:7b")
    assert s.llm_model_override == "qwen2.5:7b"


def test_temperature_override_numeric(settings) -> None:
    s = settings(LLM_TEMPERATURE="0.1")
    assert s.llm_temperature_override == 0.1
    assert s.llm_temperature_force_null is False


def test_temperature_override_null(settings) -> None:
    s = settings(LLM_TEMPERATURE="null")
    assert s.llm_temperature_override is None
    assert s.llm_temperature_force_null is True


def test_ollama_base_url_auto_enables_json_mode(settings) -> None:
    s = settings(OPENAI_BASE_URL="http://localhost:11434/v1")
    assert s.llm_json_mode is True


def test_openai_base_url_keeps_json_mode_off(settings) -> None:
    s = settings(OPENAI_BASE_URL="https://api.openai.com/v1")
    assert s.llm_json_mode is False


def test_explicit_json_mode_wins_over_auto(settings) -> None:
    # Pointed at OpenAI (auto would default to False) but explicit opt-in.
    s = settings(
        OPENAI_BASE_URL="https://api.openai.com/v1",
        PIPE_LLM_JSON_MODE="1",
    )
    assert s.llm_json_mode is True
