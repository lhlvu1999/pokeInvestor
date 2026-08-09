"""Transcript token-budget helpers.

The LLM context window is finite (qwen2.5 native is 32k; Ollama's default
is 8k; OpenAI's gpt-4o-mini is 128k). If the rendered prompt overflows the
runner truncates it — and Ollama in particular keeps only the first 4
tokens, throwing away the system instructions and breaking structured
output. This module estimates whether a transcript fits and, when not,
clips it to a *head + tail* slice that preserves the framing on both ends
of the video where the meaty product talk usually lives.

We avoid pulling in `tiktoken` to keep the dependency footprint small.
English text on BPE tokenizers averages roughly 3.5 to 4 characters per
token; we use 4 with a small safety margin so the estimate is biased to
*overestimate* slightly. The cost of overestimating is a marginally
smaller transcript; the cost of underestimating is a hard timeout, so
the bias is deliberate.
"""

from __future__ import annotations

from dataclasses import dataclass

# Characters-per-token heuristic. English BPE averages ~3.7; we round up
# to 4 + apply a multiplicative safety margin in `estimate_tokens` so the
# budget math is conservative for the qwen / gpt families.
_CHARS_PER_TOKEN = 4.0
_SAFETY_MARGIN = 1.1  # report 10% more tokens than the raw char/4 would say.


def estimate_tokens(text: str) -> int:
    """Conservative upper-bound estimate of the token count of `text`.

    Not exact — intentionally biased high so the budget math doesn't
    underestimate and trigger a runtime truncation.
    """
    if not text:
        return 0
    raw = len(text) / _CHARS_PER_TOKEN
    return max(1, int(raw * _SAFETY_MARGIN))


def _slice_at_char_boundary(text: str, target_chars: int, *, from_end: bool) -> str:
    """Slice `target_chars` characters from the start or end of `text`, then
    nudge the boundary to the nearest whitespace so we don't cut in the
    middle of a word. Returns the original text when `target_chars >= len`.
    """
    if target_chars >= len(text):
        return text
    if target_chars <= 0:
        return ""
    if from_end:
        cut = len(text) - target_chars
        # Move forward to next whitespace so the slice starts cleanly.
        nudge = text.find(" ", cut)
        if nudge != -1 and nudge - cut < 80:
            cut = nudge + 1
        return text[cut:]
    # from_end == False — slice from the start.
    cut = target_chars
    # Move back to the previous whitespace so we end on a word boundary.
    nudge = text.rfind(" ", 0, cut)
    if nudge != -1 and cut - nudge < 80:
        cut = nudge
    return text[:cut]


@dataclass(frozen=True)
class FitResult:
    """Output of `fit_transcript`."""

    text: str
    """Transcript text to send. Equal to the input when it fit, or a
    head + ellipsis + tail concatenation when clipped."""
    clipped: bool
    """True iff we had to clip the transcript to fit the budget."""
    estimated_tokens: int
    """Estimate of `text`'s token count (post-clip if clipped)."""
    budget_tokens: int
    """Token budget we targeted for the transcript."""


# Marker text inserted between the head and tail when we clip. Stays human
# readable and small so the model knows there's a gap. Counted into the
# budget below.
_CLIP_MARKER = "\n\n[... transcript clipped for length — middle removed ...]\n\n"


def fit_transcript(
    transcript: str,
    *,
    fixed_overhead_tokens: int,
    context_tokens: int,
    max_output_tokens: int,
    head_ratio: float = 0.6,
    min_transcript_tokens: int = 500,
) -> FitResult:
    """Fit `transcript` into the LLM context budget, clipping head + tail
    if needed.

    Budget math (all in tokens):
        budget = context - max_output - fixed_overhead - safety_pad
        safety_pad is implicit in `estimate_tokens`'s 10% margin.

    Args:
        transcript: full text to fit.
        fixed_overhead_tokens: estimated tokens consumed by everything
            other than the transcript itself — system prompt, the
            non-transcript portion of the user template, the title, etc.
            Caller computes this once per request.
        context_tokens: hard ceiling of the model's context window.
        max_output_tokens: tokens we want to leave room for in the response.
        head_ratio: fraction of the transcript budget allocated to the
            *start* of the video; the remainder goes to the *end*.
            Defaults to 0.6 (60/40 head/tail) — most Pokémon investment
            videos front-load product picks and end with summaries.
        min_transcript_tokens: when the resulting transcript budget falls
            below this floor (because `fixed_overhead` ate the context),
            the request is hopeless — caller should skip the video and
            record an error rather than send a near-empty prompt.

    Returns:
        `FitResult` with `text=""` and `clipped=False` only when the input
        was empty. When clipping was necessary but the budget is too small
        to be useful, the result still contains the clipped text and the
        caller is expected to compare `estimated_tokens` / `budget_tokens`
        against its own threshold (we don't raise — the caller decides
        what to do).
    """
    if head_ratio < 0.0 or head_ratio > 1.0:
        raise ValueError("head_ratio must be in [0, 1]")

    transcript_budget = max(
        0, context_tokens - max_output_tokens - fixed_overhead_tokens
    )

    actual = estimate_tokens(transcript)
    if actual <= transcript_budget:
        return FitResult(
            text=transcript,
            clipped=False,
            estimated_tokens=actual,
            budget_tokens=transcript_budget,
        )

    # Budget too small to be meaningful — return what we have and let the
    # caller decide.
    if transcript_budget < min_transcript_tokens:
        # Still clip to *something*; otherwise the caller might send the
        # untruncated transcript and trip Ollama's runner.
        clipped_chars = max(0, int(transcript_budget * _CHARS_PER_TOKEN))
        return FitResult(
            text=transcript[:clipped_chars],
            clipped=True,
            estimated_tokens=estimate_tokens(transcript[:clipped_chars]),
            budget_tokens=transcript_budget,
        )

    # Reserve a few tokens for the clip marker we'll insert between halves.
    marker_tokens = estimate_tokens(_CLIP_MARKER)
    halves_budget = max(0, transcript_budget - marker_tokens)
    head_budget_tokens = int(halves_budget * head_ratio)
    tail_budget_tokens = halves_budget - head_budget_tokens

    head_chars = int(head_budget_tokens * _CHARS_PER_TOKEN / _SAFETY_MARGIN)
    tail_chars = int(tail_budget_tokens * _CHARS_PER_TOKEN / _SAFETY_MARGIN)

    head = _slice_at_char_boundary(transcript, head_chars, from_end=False)
    tail = _slice_at_char_boundary(transcript, tail_chars, from_end=True)
    clipped_text = f"{head}{_CLIP_MARKER}{tail}"

    return FitResult(
        text=clipped_text,
        clipped=True,
        estimated_tokens=estimate_tokens(clipped_text),
        budget_tokens=transcript_budget,
    )
