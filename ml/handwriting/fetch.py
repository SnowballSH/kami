"""Downloads the handwriting bundle: `python -m handwriting.fetch <directory>`, stdlib only.

Each file is fetched from its pinned revision, checked against its pinned size and SHA-256, and only
then moved into place; files already there and intact are kept. The container build runs this.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import tempfile
import urllib.request
from pathlib import Path

from handwriting.bundle import CHUNK_BYTES, is_intact
from handwriting.sources import BUNDLE, PinnedFile

TIMEOUT_S = 60


def download(pinned: PinnedFile, directory: Path) -> None:
    target = directory / pinned.name
    if is_intact(target, pinned):
        return
    digest = hashlib.sha256()
    size = 0
    handle, temporary = tempfile.mkstemp(dir=directory, prefix=f".{pinned.name}.")
    try:
        with (
            os.fdopen(handle, "wb") as file,
            urllib.request.urlopen(pinned.url, timeout=TIMEOUT_S) as response,
        ):
            while chunk := response.read(CHUNK_BYTES):
                digest.update(chunk)
                size += len(chunk)
                file.write(chunk)
        if size != pinned.size or digest.hexdigest() != pinned.sha256:
            raise ValueError(
                f"{pinned.url}: got {size} bytes with sha256 {digest.hexdigest()}, "
                f"expected {pinned.size} bytes with sha256 {pinned.sha256}"
            )
        Path(temporary).chmod(0o644)
        Path(temporary).replace(target)
    finally:
        Path(temporary).unlink(missing_ok=True)


def fetch(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for pinned in BUNDLE:
        download(pinned, directory)
        print(f"{pinned.name}: {pinned.repository}@{pinned.revision[:12]} {pinned.path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    fetch(parser.parse_args().directory)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        sys.exit(f"handwriting.fetch: {error}")
