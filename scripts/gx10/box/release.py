"""Release integrity and application readiness, without starting services."""

import hashlib
import json
import sys
import urllib.request
from pathlib import Path

REQUIRED = (
    "dist/index.html",
    "app/server.js",
    "app/snapshot.js",
    "app/quickdraw.ndjson.gz",
    "box/install.sh",
    "box/start.sh",
    "box/stop.sh",
    "box/autostart.sh",
    "box/release.py",
)


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def write(directory: Path) -> None:
    hashes = {
        str(path.relative_to(directory)): digest(path)
        for part in ("app", "box", "dist")
        for path in (directory / part).rglob("*")
        if path.is_file()
    }
    (directory / "release.json").write_text(json.dumps(hashes, sort_keys=True))


def verify(directory: Path) -> None:
    hashes: object = json.loads((directory / "release.json").read_text())
    if not isinstance(hashes, dict) or not set(REQUIRED).issubset(hashes):
        raise ValueError("incomplete release")
    for name, expected in hashes.items():
        if (
            not isinstance(name, str)
            or Path(name).is_absolute()
            or ".." in Path(name).parts
        ):
            raise ValueError("invalid release path")
        if digest(directory / name) != expected:
            raise ValueError(f"corrupt release file: {name}")
    for name in REQUIRED:
        if (directory / name).stat().st_size == 0:
            raise ValueError(f"empty release file: {name}")


def ready(directory: Path, url: str) -> None:
    with urllib.request.urlopen(f"{url}/", timeout=3) as response:
        if response.read() != (directory / "dist/index.html").read_bytes():
            raise ValueError("the running client does not match this release")
    with urllib.request.urlopen(f"{url}/api/boards", timeout=3) as response:
        payload: object = json.load(response)
        if not isinstance(payload, dict) or not isinstance(payload.get("boards"), list):
            raise ValueError("board API is not ready")


def main() -> None:
    action, root, *args = sys.argv[1:]
    directory = Path(root)
    if action == "write":
        write(directory)
    elif action == "verify":
        verify(directory)
    elif action == "ready":
        ready(directory, args[0])
    else:
        raise ValueError("expected write, verify or ready")


if __name__ == "__main__":
    main()
