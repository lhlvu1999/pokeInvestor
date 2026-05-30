"""Pure-function tests for `prompts.render_user_template`.

These don't touch the DB so they're safe to run in CI without a Postgres.
"""

from poke_pipeline.prompts import render_user_template


def test_render_substitutes_title_and_transcript() -> None:
    out = render_user_template(
        "Title: {{title}}\n---\n{{transcript}}",
        title="My Video",
        transcript="hello world",
    )
    assert out == "Title: My Video\n---\nhello world"


def test_render_is_literal_substitution() -> None:
    # Curly braces in the prompt body itself should not be touched.
    out = render_user_template(
        "Use { not {{title}}, and respond as JSON: {}",
        title="X",
        transcript="Y",
    )
    assert out == "Use { not X, and respond as JSON: {}"


def test_render_handles_missing_placeholders() -> None:
    out = render_user_template("no placeholders here", title="x", transcript="y")
    assert out == "no placeholders here"
