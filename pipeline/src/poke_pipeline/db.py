"""Postgres connection helpers.

We use psycopg 3 in sync mode with a single connection-pool object per
process. The pipeline is a batch job, not a server — sync is simpler to
read, and connection cost is amortized across all phases of one CLI
invocation.

The pool is constructed lazily on first call to `get_pool()` so importing
this module is cheap and doesn't fail when DATABASE_URL is missing (useful
for unit tests of pure helpers).
"""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from poke_pipeline.config import load_settings

if TYPE_CHECKING:
    from collections.abc import Iterator

log = logging.getLogger(__name__)

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    """Return the process-wide connection pool, creating it lazily."""
    global _pool
    if _pool is None:
        settings = load_settings()
        _pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=1,
            max_size=4,
            kwargs={"row_factory": dict_row},
            open=False,
        )
        _pool.open()
        log.debug("opened psycopg pool")
    return _pool


def close_pool() -> None:
    """Close the pool. Idempotent. Call from CLI teardown."""
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection[dict[str, Any]]]:
    """Borrow a connection from the pool. Commits on clean exit, rolls
    back on exception. Use for read-only or single-transaction work.
    """
    pool = get_pool()
    with pool.connection() as conn:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
