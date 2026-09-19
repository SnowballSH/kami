"""Quick, Draw!'s binary format: parse it, write it, range-fetch the head of each category file."""

from __future__ import annotations

import json
import struct
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import TypeAlias

import numpy as np
from numpy.typing import NDArray

BINARY_BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full/binary"
BYTES_PER_MEGABYTE = 1_000_000
DOWNLOAD_WORKERS = 8
DOWNLOAD_TIMEOUT_SECONDS = 120
DOWNLOAD_ATTEMPTS = 3
MANIFEST_NAME = "manifest.json"

_HEADER = struct.Struct("<Q2sBIH")
_POINT_COUNT = struct.Struct("<H")

XyStroke: TypeAlias = tuple[NDArray[np.uint8], NDArray[np.uint8]]


@dataclass(frozen=True, slots=True)
class Drawing:
    key_id: int
    countrycode: str
    recognized: bool
    timestamp: int
    strokes: list[XyStroke]


def _record_end(buffer: bytes | memoryview, start: int) -> int | None:
    """Offset just past the record at `start`, or None when the buffer ends before it does."""
    if start + _HEADER.size > len(buffer):
        return None
    stroke_count: int = _HEADER.unpack_from(buffer, start)[4]
    offset = start + _HEADER.size
    for _ in range(stroke_count):
        if offset + _POINT_COUNT.size > len(buffer):
            return None
        (points,) = _POINT_COUNT.unpack_from(buffer, offset)
        offset += _POINT_COUNT.size + 2 * points
    return offset if offset <= len(buffer) else None


def complete_length(buffer: bytes | memoryview) -> int:
    """Length of the longest prefix of `buffer` made of whole records."""
    offset = 0
    while (end := _record_end(buffer, offset)) is not None:
        offset = end
    return offset


def _decode(buffer: bytes | memoryview, start: int) -> Drawing:
    key_id, country, recognized, timestamp, stroke_count = _HEADER.unpack_from(buffer, start)
    offset = start + _HEADER.size
    strokes: list[XyStroke] = []
    for _ in range(stroke_count):
        (points,) = _POINT_COUNT.unpack_from(buffer, offset)
        offset += _POINT_COUNT.size
        xs = np.frombuffer(buffer, dtype=np.uint8, count=points, offset=offset)
        ys = np.frombuffer(buffer, dtype=np.uint8, count=points, offset=offset + points)
        strokes.append((xs, ys))
        offset += 2 * points
    return Drawing(key_id, country.decode("ascii", "replace"), bool(recognized), timestamp, strokes)


def parse_drawings(buffer: bytes | memoryview) -> Iterator[Drawing]:
    offset = 0
    while (end := _record_end(buffer, offset)) is not None:
        yield _decode(buffer, offset)
        offset = end


def read_drawings(path: Path) -> Iterator[Drawing]:
    return parse_drawings(path.read_bytes())


def encode_drawing(drawing: Drawing) -> bytes:
    header = _HEADER.pack(
        drawing.key_id,
        drawing.countrycode.encode("ascii"),
        int(drawing.recognized),
        drawing.timestamp,
        len(drawing.strokes),
    )
    body = b"".join(
        _POINT_COUNT.pack(len(xs)) + xs.astype(np.uint8).tobytes() + ys.astype(np.uint8).tobytes()
        for xs, ys in drawing.strokes
    )
    return header + body


def write_drawings(path: Path, drawings: Iterable[Drawing]) -> None:
    path.write_bytes(b"".join(encode_drawing(drawing) for drawing in drawings))


def category_url(category: str) -> str:
    return f"{BINARY_BASE_URL}/{urllib.parse.quote(category)}.bin"


def category_path(data_dir: Path, category: str) -> Path:
    return data_dir / f"{category}.bin"


def _fetch_head(category: str, byte_count: int, attempts: int = DOWNLOAD_ATTEMPTS) -> bytes:
    request = urllib.request.Request(
        category_url(category), headers={"Range": f"bytes=0-{byte_count - 1}"}
    )
    try:
        with urllib.request.urlopen(request, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            body: bytes = response.read()
        return body[:byte_count]
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        if attempts <= 1:
            raise
    return _fetch_head(category, byte_count, attempts - 1)


def _load_manifest(data_dir: Path) -> dict[str, int]:
    manifest_path = data_dir / MANIFEST_NAME
    if not manifest_path.exists():
        return {}
    manifest: dict[str, int] = json.loads(manifest_path.read_text())
    return manifest


def download_categories(
    categories: Iterable[str],
    data_dir: Path,
    megabytes: float,
    on_fetched: Callable[[str], None] | None = None,
) -> dict[str, Path]:
    """Fetch the first `megabytes` of every category file, cut back to whole records.

    A category already fetched at this size or larger is left alone.
    """
    data_dir.mkdir(parents=True, exist_ok=True)
    byte_count = int(megabytes * BYTES_PER_MEGABYTE)
    manifest = _load_manifest(data_dir)
    wanted = list(categories)
    missing = [
        category
        for category in wanted
        if manifest.get(category, 0) < byte_count or not category_path(data_dir, category).exists()
    ]

    def fetch(category: str) -> None:
        head = _fetch_head(category, byte_count)
        category_path(data_dir, category).write_bytes(head[: complete_length(head)])
        manifest[category] = byte_count
        if on_fetched is not None:
            on_fetched(category)

    try:
        with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
            list(pool.map(fetch, missing))
    finally:
        (data_dir / MANIFEST_NAME).write_text(json.dumps(manifest, indent=2, sort_keys=True))
    return {category: category_path(data_dir, category) for category in wanted}
