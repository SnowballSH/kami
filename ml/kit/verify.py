"""Does a release serve? The bundle's hashes, golden parity through the recogniser, and the real
sidecar answering /health, /recognize (and /complete when there are exemplars) over HTTP."""

from __future__ import annotations

import http.client
import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from artifacts import GOLDEN_FILE, validate_bundle
from recognizer import SketchRecognizer
from render import image_sha256, render
from sidecar import create_server

HTTP_CASES = 20


@dataclass(frozen=True, slots=True)
class Verification:
    artifact_id: str
    golden_cases: int
    golden_top1_right: int
    exemplars: int
    recognize_p50_ms: float
    complete_status: int | None

    def lines(self) -> list[str]:
        complete = (
            f"/complete answered {self.complete_status}"
            if self.complete_status is not None
            else "no exemplars: /complete not checked"
        )
        return [
            f"artifactId {self.artifact_id}",
            f"golden parity: {self.golden_cases} cases render and rank as at export; "
            f"{self.golden_top1_right} named right at top-1",
            f"sidecar: /health ok, {self.exemplars} exemplars, /recognize p50 "
            f"{self.recognize_p50_ms:.1f} ms (keep-alive), {complete}",
        ]


def _points(case: dict[str, object]) -> list[list[tuple[float, float]]]:
    strokes = case["strokes"]
    assert isinstance(strokes, list)
    return [[(point["x"], point["y"]) for point in stroke] for stroke in strokes]


@contextmanager
def _sidecar(model_dir: Path) -> Iterator[http.client.HTTPConnection]:
    server = create_server(model_dir, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=30)
    try:
        yield connection
    finally:
        connection.close()
        server.shutdown()
        server.server_close()
        thread.join()


def _call(
    connection: http.client.HTTPConnection, method: str, route: str, body: object = None
) -> tuple[int, dict[str, object]]:
    payload = None if body is None else json.dumps(body)
    connection.request(method, route, payload, {"Content-Type": "application/json"})
    response = connection.getresponse()
    answer: dict[str, object] = json.loads(response.read())
    return response.status, answer


def verify_release(model_dir: Path) -> Verification:
    model_dir = model_dir.resolve(strict=True)
    artifact_id = validate_bundle(model_dir)
    recognizer = SketchRecognizer(model_dir)
    if not recognizer.render_matches:
        raise ValueError("the release was rendered by another render.py")
    cases: list[dict[str, object]] = json.loads((model_dir / GOLDEN_FILE).read_text())
    right = 0
    for number, case in enumerate(cases):
        strokes = _points(case)
        if image_sha256(render(strokes)) != case["imageSha256"]:
            raise ValueError(f"golden case {number} renders differently")
        labels = recognizer.recognize(strokes, top=3).labels
        if labels != case["top3"]:
            raise ValueError(f"golden case {number} ranks {labels}, not {case['top3']}")
        right += labels[0] == case.get("label")

    with _sidecar(model_dir) as connection:
        status, health = _call(connection, "GET", "/health")
        if status != 200 or health.get("ok") is not True:
            raise ValueError(f"/health answered {status}: {health}")
        timings: list[float] = []
        for case in cases[:HTTP_CASES]:
            started = time.perf_counter()
            status, answer = _call(connection, "POST", "/recognize", {"strokes": case["strokes"]})
            timings.append((time.perf_counter() - started) * 1000)
            if status != 200 or answer.get("labels", [])[:3] != case["top3"]:  # type: ignore[index]
                raise ValueError(f"/recognize answered {status}: {answer}")
        exemplars = int(str(health.get("exemplars", 0)))
        complete_status = None
        if exemplars:
            complete_status, _ = _call(
                connection,
                "POST",
                "/complete",
                {"strokes": cases[0]["strokes"], "name": cases[0].get("label")},
            )
    return Verification(
        artifact_id,
        len(cases),
        right,
        exemplars,
        float(np.median(timings)),
        complete_status,
    )
