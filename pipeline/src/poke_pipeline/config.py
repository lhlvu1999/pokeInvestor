"""Environment configuration. Loads the repo-root `.env` so the pipeline
shares secrets with the Next.js app instead of duplicating them.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# Repo layout:  <root>/.env, <root>/pipeline/src/poke_pipeline/config.py
REPO_ROOT = Path(__file__).resolve().parents[3]
ENV_PATH = REPO_ROOT / ".env"
if ENV_PATH.is_file():
    load_dotenv(ENV_PATH)


def _require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(
            f"Missing required env var {name}. "
            f"Set it in {ENV_PATH} or in the deployment environment."
        )
    return value


def _optional(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


@dataclass(frozen=True)
class Settings:
    database_url: str
    openai_api_key: str | None
    """`None` is OK at import time; only the `insights` phase requires it.
    For Ollama / LM Studio etc. set this to any non-empty string (the SDK
    requires *something*, but the local server ignores the value).
    """
    openai_base_url: str | None
    """Override the OpenAI API base URL. Leave unset to use api.openai.com.
    Examples: `http://localhost:11434/v1` (Ollama),
              `http://localhost:1234/v1` (LM Studio).
    """
    llm_json_mode: bool
    """When True, request `response_format = json_object` instead of OpenAI's
    strict `json_schema`. Required for backends that don't implement strict
    structured outputs (most local runners). The schema is still used to
    *describe* the shape in the system prompt, just not enforced server-side.
    """
    llm_model_override: str | None
    """If set, overrides the `model` field of every prompt at run time. Lets
    you swap providers (gpt-4o-mini ↔ qwen2.5:7b) by env without DB edits.
    `None` means "use whatever the prompt row says".
    """
    llm_temperature_override: float | None
    """If set, overrides the prompt's `temperature` at run time. Use the
    literal string `null` in env to force the API call to omit temperature
    (required for OpenAI's o-series). Anything non-numeric and non-`null`
    is treated as "no override".
    """
    llm_temperature_force_null: bool
    """True iff `LLM_TEMPERATURE=null` was set explicitly. Distinguishes
    "user wants null" from "user didn't set an override". Internal flag —
    callers should read `llm_temperature_override` together with this.
    """

    yt_transcript_cookies_path: str | None
    """Path to a Netscape-format cookies file exported from a browser
    where you're logged into YouTube. Passed to youtube-transcript-api
    via a requests.Session. Use to work around IP bans — YouTube treats
    authenticated requests more leniently. Leave unset for unauthenticated
    fetches (the default until you hit a block).
    """
    yt_transcript_proxy_url: str | None
    """Generic HTTP/SOCKS proxy URL applied to both http:// and https://
    transcript fetches (e.g. `http://user:pass@host:port`, `socks5://...`).
    The other documented workaround for IP bans. Leave unset to fetch
    directly.
    """

    # Tunables — overridable via env, sensible defaults for local dev.
    discover_max_per_source: int = 50
    """Cap on videos pulled per channel per discovery pass."""
    insights_batch_limit: int = 25
    """Max transcripts to extract in a single `insights` invocation."""
    request_timeout_sec: float = 30.0
    """Timeout for outbound HTTP (RSS, transcript). OpenAI uses its own."""


def _truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _parse_temperature_override(raw: str | None) -> tuple[float | None, bool]:
    """Returns `(value, force_null)`.

    - Unset or blank → `(None, False)` — no override, use prompt's value.
    - Literal `"null"` (case-insensitive) → `(None, True)` — force temperature
      to be omitted from the API call (needed for o-series models).
    - Numeric string → `(float, False)`.
    - Anything else → `(None, False)` and a noisy warning (handled by caller
      since config has no logger).
    """
    if raw is None or raw.strip() == "":
        return None, False
    stripped = raw.strip()
    if stripped.lower() == "null":
        return None, True
    try:
        return float(stripped), False
    except ValueError:
        return None, False


def load_settings() -> Settings:
    base_url = _optional("OPENAI_BASE_URL")
    # Auto-enable JSON mode if the user pointed us at a local backend and
    # didn't explicitly choose. Saves them one config knob in the common case.
    json_mode_env = _optional("PIPE_LLM_JSON_MODE")
    if json_mode_env is None:
        json_mode_default = bool(base_url) and "api.openai.com" not in base_url
    else:
        json_mode_default = _truthy(json_mode_env)

    model_override = _optional("LLM_MODEL")
    if model_override is not None:
        model_override = model_override.strip() or None
    temp_value, temp_force_null = _parse_temperature_override(
        _optional("LLM_TEMPERATURE"),
    )

    return Settings(
        database_url=_require("DATABASE_URL"),
        openai_api_key=_optional("OPENAI_API_KEY"),
        openai_base_url=base_url,
        llm_json_mode=json_mode_default,
        llm_model_override=model_override,
        llm_temperature_override=temp_value,
        llm_temperature_force_null=temp_force_null,
        yt_transcript_cookies_path=_optional("YT_TRANSCRIPT_COOKIES"),
        yt_transcript_proxy_url=_optional("YT_TRANSCRIPT_PROXY"),
        discover_max_per_source=int(_optional("PIPE_DISCOVER_MAX", "50") or "50"),
        insights_batch_limit=int(_optional("PIPE_INSIGHTS_BATCH", "25") or "25"),
        request_timeout_sec=float(
            _optional("PIPE_HTTP_TIMEOUT_SEC", "30") or "30"
        ),
    )
