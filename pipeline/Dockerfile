# syntax=docker/dockerfile:1.7
# Two-stage build: install deps in an `uv`-aware image, then copy the
# resulting venv into a slim runtime image. Keeps the final image free of
# build toolchain and uv itself.

FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS builder

# Speed up uv: hardlink wheels into the venv, install bytecode.
ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install dependencies first (cacheable layer).
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

# Install the project itself.
COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev


FROM python:3.12-slim-bookworm

# Non-root user. Argo will use this by default unless the workflow overrides.
RUN groupadd --system --gid 1000 app \
 && useradd --system --uid 1000 --gid app --create-home --shell /bin/bash app

WORKDIR /app

# Copy the venv from the builder. Keep the same path so the absolute paths
# in the shebangs of console_scripts (poke-pipeline) remain valid.
COPY --from=builder --chown=app:app /app/.venv /app/.venv
COPY --from=builder --chown=app:app /app/src /app/src

# `poke-pipeline` is a console_script installed by hatchling.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER app

ENTRYPOINT ["poke-pipeline"]
CMD ["--help"]
