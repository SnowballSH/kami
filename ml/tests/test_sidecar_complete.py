import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from serving import serving
from synthetic import EMPTY_CATEGORY, PER_CLASS, as_json, as_points
from test_sidecar import SQUARE, call
from tiny_model import TINY_LABELS

from exemplar_set import EXEMPLARS_DIR, META_FILE, load_exemplars
from quickdraw_bin import Drawing
from recognizer import SketchRecognizer
from sidecar import MAX_NAME_LENGTH

WORLD_SCALE = 2.5
WORLD_SHIFT = (4000.0, -700.0)


def shape_of(strokes: list[list[dict[str, float]]]) -> list[int]:
    return [len(stroke) for stroke in strokes]


def test_health_counts_the_exemplars(completing_sidecar_url: str) -> None:
    status, body = call(f"{completing_sidecar_url}/health")
    assert status == 200
    assert body["exemplars"] == PER_CLASS * (len(TINY_LABELS) - 1)


def test_a_named_sketch_comes_back_as_the_players_own_strokes_tidied_toward_an_exemplar(
    completing_sidecar_url: str,
    completing_artifacts: Path,
    sure_drawings: dict[str, list[Drawing]],
) -> None:
    sketch = as_json(sure_drawings["star"][0], WORLD_SCALE, WORLD_SHIFT)
    status, body = call(
        f"{completing_sidecar_url}/complete", {"strokes": sketch, "name": "A Mushroom"}
    )
    assert status == 200
    assert set(body) == {
        "tidied",
        "added",
        "category",
        "confidence",
        "similarity",
        "boldness",
        "exemplar",
    }
    assert body["category"] == "mushroom"
    assert 0.0 <= body["confidence"] < 0.1
    assert -1.0 <= body["similarity"] <= 1.0

    assert shape_of(body["tidied"]) == shape_of(sketch)
    exemplars = load_exemplars(completing_artifacts / EXEMPLARS_DIR)
    mushrooms = exemplars.of_label(TINY_LABELS.index("mushroom"))
    assert int(body["exemplar"]) in {int(exemplars.key_ids[row]) for row in mushrooms}


def test_an_exemplar_sent_back_in_finds_itself(
    completing_sidecar_url: str, completing_artifacts: Path
) -> None:
    exemplars = load_exemplars(completing_artifacts / EXEMPLARS_DIR)
    row = exemplars.of_label(TINY_LABELS.index("cloud")).start
    sketch = [[{"x": int(x), "y": int(y)} for x, y in stroke] for stroke in exemplars.strokes(row)]
    status, body = call(f"{completing_sidecar_url}/complete", {"strokes": sketch})
    assert status == 200
    assert body["category"] == "cloud"
    assert body["confidence"] >= 0.9 - 1e-3
    assert body["similarity"] == pytest.approx(1.0, abs=1e-3)
    assert body["exemplar"] == str(int(exemplars.key_ids[row]))
    assert body["added"] == []
    for tidied, drawn in zip(body["tidied"], sketch, strict=True):
        assert np.asarray([[point["x"], point["y"]] for point in tidied]) == pytest.approx(
            np.asarray([[point["x"], point["y"]] for point in drawn]), abs=0.5
        )


def test_the_answer_is_the_completers_own(
    completing_sidecar_url: str, tiny_artifacts: Path, sure_drawings: dict[str, list[Drawing]]
) -> None:
    drawing = sure_drawings["line"][-1]
    reading = SketchRecognizer(tiny_artifacts).read(as_points(drawing))
    _, body = call(f"{completing_sidecar_url}/complete", {"strokes": as_json(drawing), "name": ""})
    assert body["category"] == "line"
    assert body["confidence"] == pytest.approx(float(reading.probabilities[0].max()), rel=1e-5)


def test_no_exemplars_for_what_the_model_sees_is_a_404(
    completing_sidecar_url: str, sure_drawings: dict[str, list[Drawing]]
) -> None:
    sketch = as_json(sure_drawings[EMPTY_CATEGORY][0])
    for body in ({"strokes": sketch}, {"strokes": sketch, "name": EMPTY_CATEGORY}):
        status, answer = call(f"{completing_sidecar_url}/complete", body)
        assert status == 404
        assert isinstance(answer["error"], str) and answer["error"]
    assert call(f"{completing_sidecar_url}/health")[0] == 200


def test_a_model_without_an_exemplar_set_is_a_404(sidecar_url: str) -> None:
    status, answer = call(f"{sidecar_url}/complete", {"strokes": SQUARE, "name": "square"})
    assert status == 404
    assert "exemplar" in answer["error"]
    assert call(f"{sidecar_url}/recognize", {"strokes": SQUARE})[0] == 200


def test_a_single_dot_is_a_404_not_a_crash(completing_sidecar_url: str) -> None:
    status, answer = call(
        f"{completing_sidecar_url}/complete", {"strokes": [[{"x": 3, "y": 3}]], "name": "star"}
    )
    assert status == 404
    assert "error" in answer


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"strokes": []},
        {"strokes": [[{"x": 1}]]},
        {"strokes": SQUARE, "name": 7},
        {"strokes": SQUARE, "name": ["star"]},
        {"strokes": SQUARE, "name": "s" * (MAX_NAME_LENGTH + 1)},
    ],
)
def test_bad_input_is_a_400_like_everywhere_else(completing_sidecar_url: str, body: object) -> None:
    status, answer = call(f"{completing_sidecar_url}/complete", body)
    assert status == 400
    assert isinstance(answer["error"], str) and answer["error"]


def test_a_null_name_is_no_name(completing_sidecar_url: str) -> None:
    status, _ = call(f"{completing_sidecar_url}/complete", {"strokes": SQUARE, "name": None})
    assert status in (200, 404)


def test_exemplars_of_another_model_leave_recognition_serving(
    completing_artifacts: Path, tmp_path: Path, sure_drawings: dict[str, list[Drawing]]
) -> None:
    stale = tmp_path / "tiny"
    shutil.copytree(completing_artifacts, stale)
    meta_path = stale / EXEMPLARS_DIR / META_FILE
    meta_path.write_text(json.dumps({**json.loads(meta_path.read_text()), "modelSha256": "other"}))

    sketch = as_json(sure_drawings["star"][0])
    with serving(stale) as url:
        assert call(f"{url}/health")[1]["exemplars"] == 0
        assert call(f"{url}/complete", {"strokes": sketch, "name": "star"})[0] == 404
        assert call(f"{url}/recognize", {"strokes": sketch})[0] == 200
