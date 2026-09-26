import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from eye_release import EyeRelease, install, unpack


def _bundle(path: Path, files: dict[str, bytes]) -> bytes:
    with tarfile.open(path, "w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return path.read_bytes()


def _pin(path: Path, release: dict[str, str] | None) -> Path:
    path.write_text(json.dumps({"release": release}))
    return path


def test_a_null_pin_installs_nothing(tmp_path: Path) -> None:
    message = install(tmp_path / "eye", _pin(tmp_path / "pin.json", None))
    assert "k-NN" in message
    assert not (tmp_path / "eye").exists()


def test_installs_the_bundle_without_its_top_folder(tmp_path: Path) -> None:
    data = _bundle(
        tmp_path / "b.tar.gz", {"kami-eye-next/model.onnx": b"onnx", "kami-eye-next/x/y": b"z"}
    )
    pin = _pin(
        tmp_path / "pin.json",
        {"url": (tmp_path / "b.tar.gz").as_uri(), "sha256": hashlib.sha256(data).hexdigest()},
    )
    install(tmp_path / "eye", pin)
    assert (tmp_path / "eye" / "model.onnx").read_bytes() == b"onnx"
    assert (tmp_path / "eye" / "x" / "y").read_bytes() == b"z"


def test_refuses_a_bundle_whose_digest_differs(tmp_path: Path) -> None:
    _bundle(tmp_path / "b.tar.gz", {"eye/model.onnx": b"onnx"})
    pin = _pin(tmp_path / "pin.json", {"url": (tmp_path / "b.tar.gz").as_uri(), "sha256": "0" * 64})
    with pytest.raises(ValueError, match="sha256"):
        install(tmp_path / "eye", pin)
    assert not (tmp_path / "eye").exists()


def test_refuses_a_bundle_with_more_than_one_top_folder(tmp_path: Path) -> None:
    _bundle(tmp_path / "b.tar.gz", {"a/one": b"1", "b/two": b"2"})
    with pytest.raises(ValueError, match="one top-level folder"):
        unpack(tmp_path / "b.tar.gz", tmp_path / "eye")


def test_reads_the_pin(tmp_path: Path) -> None:
    pin = _pin(tmp_path / "pin.json", {"url": "https://example.org/e.tar.gz", "sha256": "AB"})
    assert EyeRelease.pinned(pin) == EyeRelease("https://example.org/e.tar.gz", "ab")
