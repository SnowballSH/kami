"""Exact, checksummed offline runtime bundles for the GX10."""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def hashes(value: object) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise ValueError("missing file hashes")
    result: dict[str, str] = {}
    for name, checksum in value.items():
        if (
            not isinstance(name, str)
            or Path(name).is_absolute()
            or ".." in Path(name).parts
            or not isinstance(checksum, str)
            or not re.fullmatch(r"[0-9a-f]{64}", checksum)
        ):
            raise ValueError("invalid file hash")
        result[name] = checksum
    return result


def version(value: object) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"\d+\.\d+(?:\.\d+)?", value):
        raise ValueError("expected an exact runtime version")
    return value


def verify_files(directory: Path, files: dict[str, str]) -> None:
    for name, checksum in files.items():
        if digest(directory / name) != checksum:
            raise ValueError(f"checksum mismatch: {name}")


def wheel_manifest(directory: Path, requirements: Path, python: str) -> dict[str, str]:
    data: object = json.loads((directory / "wheels.json").read_text())
    if (
        not isinstance(data, dict)
        or data.get("requirements") != digest(requirements)
        or data.get("python") != python
    ):
        raise ValueError("wheel cache does not match locked requirements and Python")
    files = hashes(data.get("files"))
    if any(Path(name).name != name or not name.endswith(".whl") for name in files):
        raise ValueError("invalid wheel path")
    verify_files(directory, files)
    return files


def seal_wheels(directory: Path, requirements: Path, python: str) -> None:
    files = {path.name: digest(path) for path in directory.glob("*.whl")}
    hashes(files)
    (directory / "wheels.json").write_text(
        json.dumps(
            {"requirements": digest(requirements), "python": python, "files": files},
            sort_keys=True,
        )
    )


@dataclass(frozen=True)
class Manifest:
    bun: str
    mongo: str
    python: str
    files: dict[str, str]
    requirements: str | None

    @property
    def bun_archive(self) -> str:
        return f"bun-linux-aarch64-{self.bun}.zip"

    @property
    def mongo_archive(self) -> str:
        return f"mongodb-linux-aarch64-ubuntu2404-{self.mongo}.tgz"


def load(path: Path) -> Manifest:
    data: object = json.loads(path.read_text())
    if not isinstance(data, dict) or data.get("schema") != 1:
        raise ValueError("unsupported runtime manifest")
    requirements = data.get("requirements")
    if requirements is not None and (
        not isinstance(requirements, str)
        or not re.fullmatch(r"[0-9a-f]{64}", requirements)
    ):
        raise ValueError("invalid requirements hash")
    manifest = Manifest(
        version(data.get("bun")),
        version(data.get("mongo")),
        version(data.get("python")),
        hashes(data.get("files")),
        requirements,
    )
    if not {manifest.bun_archive, manifest.mongo_archive}.issubset(manifest.files):
        raise ValueError("missing exact runtime archive")
    return manifest


def write(build: Path, cache: Path, bun: str, mongo: str, python: str) -> None:
    manifest = Manifest(version(bun), version(mongo), version(python), {}, None)
    files = {
        name: digest(cache / name)
        for name in (manifest.bun_archive, manifest.mongo_archive)
    }
    requirements = build / "eye/requirements.txt"
    requirement_hash = None
    if requirements.exists():
        files.update(
            {
                f"wheels/{name}": checksum
                for name, checksum in wheel_manifest(
                    cache / "wheels", requirements, python
                ).items()
            }
        )
        requirement_hash = digest(requirements)
    (build / "runtime.json").write_text(
        json.dumps(
            {
                "schema": 1,
                "bun": bun,
                "mongo": mongo,
                "python": python,
                "files": files,
                "requirements": requirement_hash,
            },
            sort_keys=True,
        )
    )


def check_versions(directory: Path, manifest: Manifest) -> None:
    for executable, expected in (
        ("bun", manifest.bun),
        ("mongodb/bin/mongod", f"db version v{manifest.mongo}"),
    ):
        result = subprocess.run(
            [str(directory / executable), "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if result.stdout.split("\n", 1)[0].strip() != expected:
            raise ValueError(
                f"{executable} does not match requested version {expected}"
            )


def unpack(directory: Path, cache: Path, manifest: Manifest) -> None:
    with zipfile.ZipFile(cache / manifest.bun_archive) as archive:
        (directory / "bun").write_bytes(archive.read("bun-linux-aarch64/bun"))
    (directory / "bun").chmod(0o755)
    mongod = directory / "mongodb/bin/mongod"
    mongod.parent.mkdir(parents=True)
    with tarfile.open(cache / manifest.mongo_archive) as archive:
        name = f"mongodb-linux-aarch64-ubuntu2404-{manifest.mongo}/bin/mongod"
        source = archive.extractfile(name)
        if source is None:
            raise ValueError("MongoDB archive does not contain mongod")
        with source, mongod.open("wb") as destination:
            shutil.copyfileobj(source, destination)
    mongod.chmod(0o755)
    check_versions(directory, manifest)


def install(root: Path) -> None:
    path = root / "app/runtime.json"
    manifest = load(path)
    cache = root / "cache"
    verify_files(cache, manifest.files)
    requirements = root / "app/eye/requirements.txt"
    if manifest.requirements is not None:
        if digest(requirements) != manifest.requirements:
            raise ValueError("requirements do not match the runtime manifest")
        if f"{sys.version_info.major}.{sys.version_info.minor}" != manifest.python:
            raise ValueError(f"Python {manifest.python} is required")
    elif requirements.exists():
        raise ValueError("unlocked sidecar requirements")
    runtime = root / "runtime"
    links = {
        runtime / "bun": "current/bun",
        runtime / "mongodb": "current/mongodb",
        root / "pydeps": "runtime/current/pydeps",
    }
    for link, target in links.items():
        if link.is_symlink():
            if link.readlink() != Path(target):
                raise ValueError(f"unexpected runtime link: {link}")
        elif link.exists():
            raise ValueError(f"legacy runtime at {link}; install into a staged release")
    current = runtime / "current"
    if current.exists() and not current.is_symlink():
        raise ValueError("runtime/current must be a symlink")
    releases = runtime / "releases"
    releases.mkdir(parents=True, exist_ok=True)
    destination = releases / digest(path)
    if not destination.exists():
        staging = Path(tempfile.mkdtemp(prefix=".staging-", dir=releases))
        try:
            unpack(staging, cache, manifest)
            if manifest.requirements is not None:
                pydeps = staging / "pydeps"
                subprocess.run(
                    [
                        sys.executable,
                        "-m",
                        "pip",
                        "install",
                        "--quiet",
                        "--disable-pip-version-check",
                        "--no-user",
                        "--no-index",
                        "--require-hashes",
                        "--find-links",
                        str(cache / "wheels"),
                        "--target",
                        str(pydeps),
                        "-r",
                        str(requirements),
                    ],
                    check=True,
                )
                subprocess.run(
                    [sys.executable, "-c", "import cv2, numpy, onnxruntime"],
                    env={**os.environ, "PYTHONPATH": str(pydeps)},
                    check=True,
                )
            staging.replace(destination)
        finally:
            if staging.exists():
                shutil.rmtree(staging)
    check_versions(destination, manifest)
    for link, target in links.items():
        if not link.is_symlink():
            link.symlink_to(target)
    pending = runtime / f".current-{uuid.uuid4().hex}"
    try:
        pending.symlink_to(destination)
        pending.replace(current)
    finally:
        pending.unlink(missing_ok=True)


def main() -> None:
    action, *args = sys.argv[1:]
    if action == "write":
        write(Path(args[0]), Path(args[1]), *args[2:])
    elif action == "install":
        install(Path(args[0]).resolve())
    elif action == "seal-wheels":
        seal_wheels(Path(args[0]), Path(args[1]), args[2])
    elif action == "verify-wheels":
        wheel_manifest(Path(args[0]), Path(args[1]), args[2])
    elif action == "hash":
        print(digest(Path(args[0])))
    else:
        raise ValueError("unknown runtime manifest command")


if __name__ == "__main__":
    main()
