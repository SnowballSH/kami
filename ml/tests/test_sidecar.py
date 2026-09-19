import json
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

import numpy as np
import onnxruntime as ort
import pytest
from tiny_model import TINY_LABELS, TINY_TEMPERATURE

from render import render, to_model_input

SQUARE = [
    [{"x": 0, "y": 0}, {"x": 90, "y": 0}, {"x": 90, "y": 90}, {"x": 0, "y": 90}, {"x": 0, "y": 0}]
]
SQUARE_POINTS = [[(point["x"], point["y"]) for point in stroke] for stroke in SQUARE]


def call(url: str, body: object | None = None, raw: bytes | None = None) -> tuple[int, Any]:
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def test_health(sidecar_url: str) -> None:
    status, body = call(f"{sidecar_url}/health")
    assert status == 200
    assert body == {"ok": True, "classes": len(TINY_LABELS), "model": "tiny", "renderMatches": True}


def test_recognize_answers_calibrated_probabilities_best_first(
    sidecar_url: str, tiny_artifacts: Path
) -> None:
    status, body = call(f"{sidecar_url}/recognize", {"strokes": SQUARE, "partial": False})
    assert status == 200
    assert len(body["labels"]) == len(body["probs"]) == 5
    assert set(body["labels"]) <= set(TINY_LABELS)
    assert body["probs"] == sorted(body["probs"], reverse=True)

    session = ort.InferenceSession(str(tiny_artifacts / "model.onnx"))
    (logits,) = session.run(["logits"], {"image": to_model_input(render(SQUARE_POINTS))})
    scaled = logits[0].astype(np.float64) / TINY_TEMPERATURE
    expected = np.exp(scaled - scaled.max()) / np.exp(scaled - scaled.max()).sum()
    assert body["labels"][0] == TINY_LABELS[int(np.argmax(expected))]
    assert body["probs"] == pytest.approx(np.sort(expected)[::-1][:5], rel=1e-5)


def test_top_is_honoured_and_capped_at_the_class_count(sidecar_url: str) -> None:
    _, two = call(f"{sidecar_url}/recognize", {"strokes": SQUARE, "top": 2})
    _, many = call(f"{sidecar_url}/recognize", {"strokes": SQUARE, "partial": True, "top": 100})
    assert len(two["labels"]) == 2
    assert len(many["labels"]) == len(TINY_LABELS)
    assert sum(many["probs"]) == pytest.approx(1.0)


def test_position_and_size_do_not_change_the_answer(sidecar_url: str) -> None:
    moved = [[{"x": p["x"] * 4 + 5000, "y": p["y"] * 4 - 300} for p in stroke] for stroke in SQUARE]
    _, original = call(f"{sidecar_url}/recognize", {"strokes": SQUARE})
    _, shifted = call(f"{sidecar_url}/recognize", {"strokes": moved})
    assert original == shifted


def test_embed_is_512_floats_of_unit_length(sidecar_url: str) -> None:
    status, body = call(f"{sidecar_url}/embed", {"strokes": SQUARE})
    assert status == 200
    assert len(body["embedding"]) == 512
    assert np.linalg.norm(body["embedding"]) == pytest.approx(1.0, abs=1e-5)


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"strokes": "circle"},
        {"strokes": []},
        {"strokes": [[]]},
        {"strokes": [[{"x": 1}]]},
        {"strokes": [[{"x": "1", "y": 2}]]},
        {"strokes": [[{"x": True, "y": 2}]]},
        {"strokes": [[[1, 2]]]},
        {"strokes": SQUARE, "top": 0},
        {"strokes": SQUARE, "top": 2.5},
        {"strokes": SQUARE, "partial": "yes"},
        [1, 2, 3],
    ],
)
def test_bad_input_is_a_400_with_an_error(sidecar_url: str, body: object) -> None:
    status, answer = call(f"{sidecar_url}/recognize", body)
    assert status == 400
    assert isinstance(answer["error"], str) and answer["error"]


@pytest.mark.parametrize("raw", [b"{not json", b'{"strokes": [[{"x": NaN, "y": 1}]]}', b"\xff\xfe"])
def test_garbage_bodies_are_a_400(sidecar_url: str, raw: bytes) -> None:
    status, answer = call(f"{sidecar_url}/embed", raw=raw)
    assert status == 400
    assert "error" in answer


def test_unknown_routes_are_a_404_and_the_server_keeps_answering(sidecar_url: str) -> None:
    assert call(f"{sidecar_url}/nope")[0] == 404
    assert call(f"{sidecar_url}/nope", {"strokes": SQUARE})[0] == 404
    assert call(f"{sidecar_url}/health")[0] == 200
