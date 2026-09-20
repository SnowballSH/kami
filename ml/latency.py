"""The serving-cost check of a candidate model against a reference, on the box's CPU.

Both models run `SketchRecognizer.recognize` (render + ONNX Runtime + softmax) on the same drawing,
batch 1, interleaved call by call in one process so that whatever else the box is doing weighs on
both alike; then the candidate alone answers POST /recognize over a loopback sidecar.

    python latency.py --model artifacts/eye-next --reference artifacts/kami-eye --out latency.json
"""

from __future__ import annotations

import argparse
import http.client
import json
import threading
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

from artifacts import GOLDEN_FILE
from recognizer import SketchRecognizer
from render import Point
from sidecar import create_server

WARM_UPS = 50
RUNS = 500
HTTP_RUNS = 300
THREAD_SETTINGS: tuple[int | None, ...] = (None, 1, 4)
MAX_RATIO = 1.25
MAX_RECOGNIZE_MS = 15.0

Drawing = list[list[Point]]


@dataclass(frozen=True, slots=True)
class PairedLatency:
    """p50 milliseconds of candidate and reference under one ONNX Runtime thread setting."""

    threads: int | None
    candidate_ms: float
    reference_ms: float

    @property
    def ratio(self) -> float:
        return self.candidate_ms / self.reference_ms


def golden_drawing(model_dir: Path) -> Drawing:
    """The first finished golden case: a real held-out drawing in the request's own shape."""
    cases = json.loads((model_dir / GOLDEN_FILE).read_text())
    finished = next(case for case in cases if case.get("fraction", 1.0) >= 1.0)
    return [[(point["x"], point["y"]) for point in stroke] for stroke in finished["strokes"]]


def _milliseconds(call: object, drawing: Drawing) -> float:
    started = time.perf_counter()
    call(drawing)  # type: ignore[operator]
    return (time.perf_counter() - started) * 1000


def paired_latency(
    candidate_dir: Path, reference_dir: Path, drawing: Drawing, threads: int | None
) -> PairedLatency:
    candidate = SketchRecognizer(candidate_dir, threads)
    reference = SketchRecognizer(reference_dir, threads)
    for _ in range(WARM_UPS):
        candidate.recognize(drawing)
        reference.recognize(drawing)
    timings = np.asarray(
        [
            (
                _milliseconds(candidate.recognize, drawing),
                _milliseconds(reference.recognize, drawing),
            )
            for _ in range(RUNS)
        ]
    )
    candidate_ms, reference_ms = np.median(timings, axis=0)
    return PairedLatency(threads, float(candidate_ms), float(reference_ms))


def recognize_route_ms(model_dir: Path, drawing: Drawing) -> float:
    """p50 of POST /recognize, keep-alive, against a sidecar of this process on a free port."""
    server = create_server(model_dir, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    body = json.dumps(
        {"strokes": [[{"x": x, "y": y} for x, y in stroke] for stroke in drawing], "top": 5}
    )
    try:
        connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1])
        timings: list[float] = []
        for run in range(WARM_UPS + HTTP_RUNS):
            started = time.perf_counter()
            connection.request("POST", "/recognize", body, {"Content-Type": "application/json"})
            response = connection.getresponse()
            response.read()
            if response.status != 200:
                raise RuntimeError(f"/recognize answered {response.status}")
            if run >= WARM_UPS:
                timings.append((time.perf_counter() - started) * 1000)
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    return float(np.median(timings))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    arguments = parser.parse_args()

    drawing = golden_drawing(arguments.model)
    pairs = [
        paired_latency(arguments.model, arguments.reference, drawing, threads)
        for threads in THREAD_SETTINGS
    ]
    route_ms = recognize_route_ms(arguments.model, drawing)
    default_ratio = pairs[0].ratio
    record = {
        "model": arguments.model.name,
        "reference": arguments.reference.name,
        "pairs": [{**asdict(pair), "ratio": pair.ratio} for pair in pairs],
        "recognizeRouteMs": route_ms,
        "ratio": default_ratio,
        "withinBound": default_ratio <= MAX_RATIO and route_ms <= MAX_RECOGNIZE_MS,
    }
    for pair in pairs:
        threads = "default" if pair.threads is None else str(pair.threads)
        print(
            f"threads {threads:>7}: candidate {pair.candidate_ms:.2f} ms, "
            f"reference {pair.reference_ms:.2f} ms, ratio {pair.ratio:.2f}"
        )
    print(f"POST /recognize p50 {route_ms:.2f} ms; within bound: {record['withinBound']}")
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
