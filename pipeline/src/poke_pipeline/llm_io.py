"""Helpers for talking to LLMs that lie about returning JSON.

Local models (Ollama, LM Studio, etc.) often:
  - wrap responses in ```json … ``` fences
  - prepend "Sure! Here's the JSON:" preambles
  - emit trailing prose after the closing brace
  - drop fields or guess the shape

The two functions here defend against those:
  - `parse_llm_json` extracts and parses the best-effort JSON object from a
    raw response string.
  - `build_schema_instruction` formats a JSON Schema as a compact
    instruction block we can append to the system prompt when running in
    `json_object` mode (so the model knows what to produce, even though
    the backend isn't enforcing it).
"""

from __future__ import annotations

import json
import re
from typing import Any

# Matches a ```json … ``` or ``` … ``` fence (with optional language tag).
# Non-greedy so we get the first complete fence, not the last one.
_FENCE_RE = re.compile(r"```(?:json|JSON)?\s*(.*?)\s*```", re.DOTALL)


class LLMResponseError(ValueError):
    """The model's response wasn't usable as JSON. Carries the (truncated)
    raw content so callers can log it for debugging.
    """

    def __init__(self, msg: str, *, raw: str) -> None:
        super().__init__(msg)
        self.raw = raw


def parse_llm_json(content: str) -> dict[str, Any]:
    """Best-effort JSON-object extraction.

    Tries in order:
      1. The string verbatim.
      2. The contents of the first ```json fence.
      3. The substring from the first `{` to the matching `}` (brace-balanced).

    Raises `LLMResponseError` if nothing parsed. The exception's `raw`
    attribute holds the first ~500 chars of the response for log/DB.
    """
    candidates: list[str] = []
    stripped = content.strip()
    if stripped:
        candidates.append(stripped)

    fence_match = _FENCE_RE.search(content)
    if fence_match:
        candidates.append(fence_match.group(1).strip())

    braced = _extract_balanced_object(content)
    if braced is not None:
        candidates.append(braced)

    last_error: Exception | None = None
    for candidate in candidates:
        try:
            obj = json.loads(candidate)
        except json.JSONDecodeError as exc:
            last_error = exc
            continue
        if isinstance(obj, dict):
            return obj
        last_error = ValueError(
            f"expected JSON object, got {type(obj).__name__}"
        )

    raise LLMResponseError(
        f"could not parse JSON object: {last_error}",
        raw=_truncate(content, 500),
    )


def _extract_balanced_object(text: str) -> str | None:
    """Scan for the first `{` and return the substring up to and including
    its matching `}`. Handles nested braces and double-quoted strings (so
    braces inside strings don't confuse the counter). Returns None if no
    balanced object is found.
    """
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"… [+{len(text) - limit} more chars]"


# ─── Schema → prompt instruction ────────────────────────────────────────────


def build_schema_instruction(schema: dict[str, Any]) -> str:
    """Render a compact natural-language summary of the JSON Schema, suitable
    for appending to a system prompt when the LLM backend doesn't enforce
    structured outputs (e.g. Ollama's `json_object` mode).

    Local models follow JSON Schema poorly when handed the raw spec, so we
    convert to a terse field list with type, requiredness, and enum values.
    Keeps the instruction under ~1 KB even for our full extraction schema.
    """
    lines: list[str] = [
        "Return a single JSON object matching this exact shape. "
        "Required keys must be present (use null where the value is unknown). "
        "Do NOT wrap the response in markdown fences. "
        "Do NOT include any text before or after the JSON.",
        "",
        "Schema:",
    ]
    lines.extend(_describe_object(schema, indent=0))
    return "\n".join(lines)


def _describe_object(schema: dict[str, Any], *, indent: int) -> list[str]:
    pad = "  " * indent
    out: list[str] = []
    required = set(schema.get("required") or [])
    props: dict[str, Any] = schema.get("properties") or {}
    for name, spec in props.items():
        req = "required" if name in required else "optional"
        out.append(f"{pad}- {name} ({_type_label(spec)}, {req}){_extra(spec)}")
        if _is_object(spec):
            out.extend(_describe_object(spec, indent=indent + 1))
        elif spec.get("type") == "array":
            items = spec.get("items") or {}
            if _is_object(items):
                out.append(f"{pad}  [each item:]")
                out.extend(_describe_object(items, indent=indent + 2))
            else:
                out.append(f"{pad}  [each item: {_type_label(items)}]")
    return out


def _is_object(spec: dict[str, Any]) -> bool:
    t = spec.get("type")
    if t == "object":
        return True
    if isinstance(t, list) and "object" in t:
        return True
    return False


def _type_label(spec: dict[str, Any]) -> str:
    t = spec.get("type")
    if isinstance(t, list):
        return "|".join(str(x) for x in t)
    return str(t or "any")


def _extra(spec: dict[str, Any]) -> str:
    parts: list[str] = []
    enum = spec.get("enum")
    if enum:
        rendered = ", ".join("null" if v is None else repr(v) for v in enum)
        parts.append(f"enum=[{rendered}]")
    desc = spec.get("description")
    if desc:
        parts.append(str(desc))
    return f" — {' · '.join(parts)}" if parts else ""
