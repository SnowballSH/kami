"""Installs the pinned Kami's Eye release: `python eye_release.py <directory>`, stdlib only.

`eye-release.json` names one GitHub Release asset (the tarball `retrain.py package` writes) and its
SHA-256. The tarball is downloaded, checked, and unpacked into the directory without its top-level
folder, so the directory is the artefact directory the sidecar loads (ml/CONTRACT.md). A pin of
`null` installs nothing: the image then serves the built-in k-NN until a model is mounted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

PIN_FILE = Path(__file__).parent / "eye-release.json"
CHUNK_BYTES = 1 << 20
TIMEOUT_S = 120


@dataclass(frozen=True, slots=True)
class EyeRelease:
    url: str
    sha256: str

    @classmethod
    def pinned(cls, pin_file: Path = PIN_FILE) -> EyeRelease | None:
        pin = json.loads(pin_file.read_text())
        release = pin.get("release")
        if release is None:
            return None
        return cls(url=str(release["url"]), sha256=str(release["sha256"]).lower())


def download(release: EyeRelease, target: Path) -> None:
    digest = hashlib.sha256()
    with target.open("wb") as file, urllib.request.urlopen(release.url, timeout=TIMEOUT_S) as body:
        while chunk := body.read(CHUNK_BYTES):
            digest.update(chunk)
            file.write(chunk)
    if digest.hexdigest() != release.sha256:
        raise ValueError(f"{release.url}: sha256 {digest.hexdigest()}, expected {release.sha256}")


def unpack(bundle: Path, directory: Path) -> None:
    """Every member lives under one top-level folder; that folder's contents become `directory`."""
    with tarfile.open(bundle, "r:gz") as tar:
        members = tar.getmembers()
        tops = {PurePosixPath(member.name).parts[0] for member in members}
        if len(tops) != 1:
            raise ValueError(f"{bundle.name}: expected one top-level folder, found {sorted(tops)}")
        with tempfile.TemporaryDirectory(dir=directory.parent) as staging:
            tar.extractall(staging, filter="data")
            (top,) = tops
            if directory.exists():
                shutil.rmtree(directory)
            Path(staging, top).replace(directory)


def install(directory: Path, pin_file: Path = PIN_FILE) -> str:
    release = EyeRelease.pinned(pin_file)
    if release is None:
        return "no Eye release pinned; the image recognises with the built-in k-NN"
    directory.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory.parent) as scratch:
        bundle = Path(scratch, "eye.tar.gz")
        download(release, bundle)
        unpack(bundle, directory)
    return f"installed {release.url} into {directory}"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    print(install(parser.parse_args().directory))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as error:
        sys.exit(f"eye_release: {error}")
