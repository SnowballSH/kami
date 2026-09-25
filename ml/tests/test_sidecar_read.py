"""The sidecar's `/read` route and its capabilities, with and without either model."""

import json
import os
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from test_sidecar import SQUARE, call

from render import Point
from sidecar import DEFAULT_HANDWRITING_DIR, MAX_STROKES, ReadsHandwriting, serve

FIXTURES = Path(__file__).parent / "fixtures" / "handwriting"


class EchoReader:
    """Reads any ink as how many strokes it has; one stroke is a drawing."""

    name = "echo"

    def read(self, strokes: list[list[Point]]) -> str | None:
        return None if len(strokes) == 1 else f"{len(strokes)} strokes"


@contextmanager
def reading_sidecar(reader: ReadsHandwriting | None) -> Iterator[str]:
    server = serve(None, reader, 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_health_says_which_capabilities_are_loaded() -> None:
    with reading_sidecar(EchoReader()) as url:
        status, body = call(f"{url}/health")
    assert status == 200
    assert body == {
        "ok": True,
        "capabilities": {"eye": False, "handwriting": True},
        "handwriting": {"model": "echo"},
    }


def test_read_answers_the_text_or_null() -> None:
    with reading_sidecar(EchoReader()) as url:
        assert call(f"{url}/read", {"strokes": SQUARE * 2}) == (200, {"text": "2 strokes"})
        assert call(f"{url}/read", {"strokes": SQUARE}) == (200, {"text": None})


def test_read_holds_ink_to_the_drawing_limits() -> None:
    with reading_sidecar(EchoReader()) as url:
        status, body = call(f"{url}/read", {"strokes": SQUARE * (MAX_STROKES + 1)})
        assert status == 400
        assert "strokes" in body["error"]
        assert call(f"{url}/read", {"strokes": []})[0] == 400


def test_without_a_model_a_capability_is_unavailable_not_missing() -> None:
    with reading_sidecar(None) as url:
        assert call(f"{url}/read", {"strokes": SQUARE})[0] == 503
        status, body = call(f"{url}/recognize", {"strokes": SQUARE})
        assert status == 503
        assert "Eye" in body["error"]
        assert call(f"{url}/health")[1]["capabilities"] == {"eye": False, "handwriting": False}


def handwriting_bundle() -> Path | None:
    directory = Path(os.environ.get("KAMI_HANDWRITING_MODEL", "") or DEFAULT_HANDWRITING_DIR)
    return directory if directory.exists() else None


@pytest.mark.skipif(handwriting_bundle() is None, reason="python -m handwriting.fetch models/...")
@pytest.mark.parametrize("fixture", sorted(FIXTURES.glob("*.json")), ids=lambda path: path.stem)
def test_the_real_reader_reads_kamis_own_pen(fixture: Path) -> None:
    from handwriting.reader import HandwritingReader

    bundle = handwriting_bundle()
    assert bundle is not None
    note = json.loads(fixture.read_text())
    strokes = [[(point["x"], point["y"]) for point in stroke] for stroke in note["strokes"]]
    assert HandwritingReader.load(bundle, threads=1).read(strokes) == note["text"]
