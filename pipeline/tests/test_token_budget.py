"""Unit tests for token_budget.

Estimator is approximate; tests only assert order-of-magnitude correctness
plus the structural invariants `fit_transcript` is supposed to keep
(head/tail preserved when clipping, no clipping when it fits, etc).
"""

from __future__ import annotations

from poke_pipeline.token_budget import (
    estimate_tokens,
    fit_transcript,
)


def test_estimate_tokens_empty() -> None:
    assert estimate_tokens("") == 0


def test_estimate_tokens_grows_with_length() -> None:
    short = estimate_tokens("hello world")
    longer = estimate_tokens("hello world " * 100)
    assert longer > short
    # ~12 chars/token-equivalent input x 100 -> roughly 1200 chars -> ~300+
    # tokens with the 10% safety margin.
    assert 250 < longer < 500


def test_fit_short_transcript_not_clipped() -> None:
    text = "We picked up some Pokémon ETBs today."
    result = fit_transcript(
        text,
        fixed_overhead_tokens=200,
        context_tokens=8192,
        max_output_tokens=1024,
    )
    assert not result.clipped
    assert result.text == text
    assert result.budget_tokens > 0


def test_fit_long_transcript_is_clipped_head_and_tail() -> None:
    head = "BEGIN_OF_TRANSCRIPT " * 1000  # ~5k tokens (estimator-wise)
    middle = "MIDDLE_FILLER " * 4000
    tail = "END_OF_TRANSCRIPT " * 1000
    text = head + middle + tail

    result = fit_transcript(
        text,
        fixed_overhead_tokens=500,
        context_tokens=8192,
        max_output_tokens=1024,
        head_ratio=0.5,
    )
    assert result.clipped
    assert result.estimated_tokens <= result.budget_tokens + 50  # small slack
    # Both ends should survive; the clipped middle should not.
    assert "BEGIN_OF_TRANSCRIPT" in result.text
    assert "END_OF_TRANSCRIPT" in result.text
    # Without the clip the original had ~12000 instances of MIDDLE_FILLER —
    # post-clip should have far fewer (some may sneak in at the boundaries).
    assert result.text.count("MIDDLE_FILLER") < 200


def test_head_ratio_skews_toward_head() -> None:
    head = "AAAA " * 5000
    tail = "ZZZZ " * 5000
    text = head + tail

    biased = fit_transcript(
        text,
        fixed_overhead_tokens=100,
        context_tokens=4096,
        max_output_tokens=512,
        head_ratio=0.9,
    )
    # 90% of the budget goes to the head — there should be far more A's
    # than Z's in the clipped result.
    a_count = biased.text.count("AAAA")
    z_count = biased.text.count("ZZZZ")
    assert a_count > z_count * 2, f"a={a_count} z={z_count} (expected a >> z)"


def test_min_transcript_returned_when_budget_tiny() -> None:
    text = "anything " * 1000
    result = fit_transcript(
        text,
        # Overhead alone exhausts the context window — nothing meaningful
        # is left for the transcript.
        fixed_overhead_tokens=7800,
        context_tokens=8192,
        max_output_tokens=1024,
        min_transcript_tokens=500,
    )
    # The function still returns a (possibly empty) result; the caller is
    # expected to compare `budget_tokens` to `min_transcript_tokens` and
    # skip if too small. We just verify the structural contract here.
    assert result.budget_tokens < 500
    assert result.clipped


def test_head_ratio_validation() -> None:
    import pytest

    with pytest.raises(ValueError):
        fit_transcript(
            "x" * 100,
            fixed_overhead_tokens=10,
            context_tokens=1000,
            max_output_tokens=100,
            head_ratio=1.5,
        )
