"""Parity check for a trained artefact directory (KAMI_EYE_MODEL, default artifacts/smoke)."""

import json
import os
from pathlib import Path

import pytest

from recognizer import SketchRecognizer
from render import image_sha256, render

ARTIFACTS_DIR = Path(
    os.environ.get("KAMI_EYE_MODEL", Path(__file__).parent.parent / "artifacts" / "smoke")
)
GOLDEN_PATH = ARTIFACTS_DIR / "golden.json"

pytestmark = pytest.mark.skipif(not GOLDEN_PATH.exists(), reason=f"no {GOLDEN_PATH}")


def points_of(case: dict[str, list[list[dict[str, float]]]]) -> list[list[tuple[float, float]]]:
    return [[(point["x"], point["y"]) for point in stroke] for stroke in case["strokes"]]


def test_golden_cases_render_and_rank_as_they_did_at_export() -> None:
    cases = json.loads(GOLDEN_PATH.read_text())
    recognizer = SketchRecognizer(ARTIFACTS_DIR)
    assert recognizer.render_matches
    assert len(cases) >= 40
    for case in cases:
        strokes = points_of(case)
        assert image_sha256(render(strokes)) == case["imageSha256"]
        assert recognizer.recognize(strokes, top=3).labels == case["top3"]
