"""YouTube transcript + LLM extraction pipeline.

The pipeline reads and writes the same Postgres tables the Next.js app does,
but never imports from `src/`. Drizzle owns the schema; we just use SQL.
"""

__version__ = "0.1.0"
