"""Keep alert messages inside what a chat webhook accepts.

Discord refuses a message over 2000 characters. A refused message is not marked as
sent, so it would be retried, and refused, on every run, and the alerts would never
arrive. A large batch therefore goes out as several messages, and only the ones that
were delivered are marked.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

MAX_MESSAGE_CHARS = 1800
MAX_NAME_CHARS = 120


def trim_name(name: str) -> str:
    return name if len(name) <= MAX_NAME_CHARS else name[: MAX_NAME_CHARS - 1] + "…"


def split_alerts[T](
    alerts: Sequence[T],
    build: Callable[[tuple[T, ...]], str],
    limit: int = MAX_MESSAGE_CHARS,
) -> list[tuple[T, ...]]:
    """Group alerts so each group's message, as built by ``build``, fits in ``limit``."""
    groups: list[list[T]] = []
    for a in alerts:
        if groups and len(build(tuple([*groups[-1], a]))) <= limit:
            groups[-1].append(a)
        else:
            groups.append([a])
    return [tuple(g) for g in groups]


def deliver[T](
    groups: Sequence[tuple[T, ...]],
    build: Callable[[tuple[T, ...]], str],
    post: Callable[[str], bool],
    on_delivered: Callable[[tuple[T, ...]], None],
) -> int:
    """Send one message per group, in order. Stops at the first refusal so the rest
    are retried next run. Returns how many alerts were delivered."""
    delivered = 0
    for g in groups:
        if not post(build(g)):
            break
        on_delivered(g)
        delivered += len(g)
    return delivered
