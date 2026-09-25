import hashlib
import io
import urllib.request
from pathlib import Path

import pytest

import handwriting.fetch as fetch
from handwriting.bundle import BundleError, verify_bundle
from handwriting.sources import BUNDLE, PinnedFile

CONTENT = b"pinned bytes"
PINNED = PinnedFile(
    "model.onnx", "someone/model", "0" * 40, "model.onnx", hashlib.sha256(CONTENT).hexdigest(), 12
)


def test_every_pinned_file_is_named_uniquely_and_pinned_to_a_commit() -> None:
    assert len({pinned.name for pinned in BUNDLE}) == len(BUNDLE)
    for pinned in BUNDLE:
        assert len(pinned.revision) == 40
        assert len(pinned.sha256) == 64
        assert pinned.url.startswith(f"https://huggingface.co/{pinned.repository}/resolve/")


def test_an_intact_bundle_is_accepted(tmp_path: Path) -> None:
    (tmp_path / PINNED.name).write_bytes(CONTENT)
    assert verify_bundle(tmp_path, (PINNED,)) == tmp_path.resolve()


def test_a_missing_file_is_named(tmp_path: Path) -> None:
    with pytest.raises(BundleError, match=r"model\.onnx is missing"):
        verify_bundle(tmp_path, (PINNED,))


def test_an_altered_file_is_refused(tmp_path: Path) -> None:
    (tmp_path / PINNED.name).write_bytes(b"pinned bytez")
    with pytest.raises(BundleError, match=r"is not the pinned someone/model/model\.onnx"):
        verify_bundle(tmp_path, (PINNED,))


def serve_bytes(monkeypatch: pytest.MonkeyPatch, body: bytes) -> list[str]:
    asked: list[str] = []

    def urlopen(url: str, timeout: float) -> io.BytesIO:
        asked.append(url)
        return io.BytesIO(body)

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return asked


def test_a_download_lands_only_when_its_checksum_matches(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked = serve_bytes(monkeypatch, CONTENT)
    fetch.download(PINNED, tmp_path)
    assert (tmp_path / PINNED.name).read_bytes() == CONTENT
    assert asked == [PINNED.url]
    fetch.download(PINNED, tmp_path)
    assert asked == [PINNED.url]


def test_a_tampered_download_leaves_nothing_behind(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    serve_bytes(monkeypatch, b"tampered byt")
    with pytest.raises(ValueError, match="expected 12 bytes with sha256"):
        fetch.download(PINNED, tmp_path)
    assert list(tmp_path.iterdir()) == []
