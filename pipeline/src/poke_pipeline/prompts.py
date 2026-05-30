"""Read the active prompt row from the `prompts` table.

The Next.js admin UI writes new prompt versions. The pipeline only reads
the currently-active row, so each run picks up edits without a redeploy.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from poke_pipeline.db import connection

YOUTUBE_INSIGHT_PROMPT_NAME = "youtube_insight_extraction"


@dataclass(frozen=True)
class ActivePrompt:
    id: str
    name: str
    version: int
    model: str
    temperature: float | None
    system_text: str
    user_template: str
    response_schema: dict[str, Any]


def get_active_prompt(name: str = YOUTUBE_INSIGHT_PROMPT_NAME) -> ActivePrompt | None:
    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text AS id, name, version, model, temperature,
                   system_text, user_template, response_schema
            FROM prompts
            WHERE name = %s AND is_active = true
            LIMIT 1
            """,
            (name,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return ActivePrompt(
            id=row["id"],
            name=row["name"],
            version=row["version"],
            model=row["model"],
            temperature=row["temperature"],
            system_text=row["system_text"],
            user_template=row["user_template"],
            response_schema=row["response_schema"],
        )


def render_user_template(template: str, *, title: str, transcript: str) -> str:
    """Tiny mustache-ish substitution. Only `{{title}}` and `{{transcript}}`
    are recognized — we keep this intentionally dumb to avoid surprising
    behavior when prompt authors type curly braces in their templates.
    """
    return template.replace("{{title}}", title).replace(
        "{{transcript}}", transcript
    )
