"""A handwriting bundle on disk: every pinned file present, whole and exactly the pinned bytes."""

from __future__ import annotations

import hashlib
from pathlib import Path

from handwriting.sources import BUNDLE, PinnedFile

CHUNK_BYTES = 1 << 20


class BundleError(ValueError):
    pass


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def is_intact(path: Path, pinned: PinnedFile) -> bool:
    return (
        path.is_file() and path.stat().st_size == pinned.size and sha256_of(path) == pinned.sha256
    )


def verify_bundle(directory: Path, files: tuple[PinnedFile, ...] = BUNDLE) -> Path:
    """The resolved directory, or a BundleError naming the first file that is missing or altered."""
    directory = directory.resolve(strict=True)
    for pinned in files:
        path = directory / pinned.name
        if not path.is_file():
            raise BundleError(f"{path} is missing (python -m handwriting.fetch {directory})")
        if not is_intact(path, pinned):
            raise BundleError(f"{path} is not the pinned {pinned.repository}/{pinned.path}")
    return directory
