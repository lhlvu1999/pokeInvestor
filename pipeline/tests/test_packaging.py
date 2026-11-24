"""Guards the container build, which is too slow to run on every check.

The pipeline image once could not be built for months: pyproject.toml named a
README the build needs, but .dockerignore excluded it and the Dockerfile never
copied it. Building the project then failed, and every scheduled job runs from
that image. A file that package metadata points at must reach the build.
"""

import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _declared_files() -> list[str]:
    meta = tomllib.loads((ROOT / "pyproject.toml").read_text())["project"]
    files: list[str] = []
    readme = meta.get("readme")
    if isinstance(readme, str):
        files.append(readme)
    elif isinstance(readme, dict) and "file" in readme:
        files.append(readme["file"])
    lic = meta.get("license")
    if isinstance(lic, dict) and "file" in lic:
        files.append(lic["file"])
    files.extend(meta.get("license-files", []))
    return files


def test_every_file_the_package_metadata_names_reaches_the_image_build():
    dockerfile = (ROOT / "Dockerfile").read_text()
    ignored = {
        line.strip()
        for line in (ROOT / ".dockerignore").read_text().splitlines()
        if line.strip() and not line.startswith("#")
    }
    for name in _declared_files():
        assert name not in ignored, f"{name} is named in pyproject.toml but excluded by .dockerignore"
        copies = [ln for ln in dockerfile.splitlines() if ln.startswith("COPY") and name in ln]
        assert copies, f"{name} is named in pyproject.toml but the Dockerfile never copies it"


def test_the_dockerfile_installs_from_the_locked_dependencies_only():
    text = (ROOT / "Dockerfile").read_text()
    assert "uv sync --frozen --no-dev" in text
    assert "COPY pyproject.toml uv.lock" in text


def test_the_image_runs_the_cli_as_a_non_root_user():
    text = (ROOT / "Dockerfile").read_text()
    assert "USER app" in text
    assert 'ENTRYPOINT ["poke-pipeline"]' in text
