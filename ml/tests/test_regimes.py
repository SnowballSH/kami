"""The two regimes of a look (finished, under the pen) through artefacts, recogniser, sidecar."""

import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from serving import serving
from test_sidecar import SQUARE, SQUARE_POINTS, call
from tiny_model import TINY_TEMPERATURE

from artifacts import CertaintyFloors, seal_bundle
from recognizer import SketchRecognizer

PARTIAL_TEMPERATURE = 3.4
FLOORS = {"finished": 0.8, "partial": None}


def with_preprocess(source: Path, destination: Path, extra: dict[str, object]) -> Path:
    shutil.copytree(source, destination)
    preprocess = json.loads((destination / "preprocess.json").read_text())
    (destination / "preprocess.json").write_text(json.dumps({**preprocess, **extra}))
    seal_bundle(destination)
    return destination


@pytest.fixture(scope="module")
def regime_artifacts(tmp_path_factory: pytest.TempPathFactory, tiny_artifacts: Path) -> Path:
    return with_preprocess(
        tiny_artifacts,
        tmp_path_factory.mktemp("regimes") / "tiny",
        {"temperaturePartial": PARTIAL_TEMPERATURE, "certainAbove": FLOORS},
    )


def test_a_model_from_before_the_regimes_reads_both_looks_alike(tiny_artifacts: Path) -> None:
    recognizer = SketchRecognizer(tiny_artifacts)
    assert recognizer.temperature_partial == recognizer.temperature == TINY_TEMPERATURE
    assert recognizer.certain_above is None
    finished = recognizer.recognize(SQUARE_POINTS)
    assert recognizer.recognize(SQUARE_POINTS, partial=True) == finished


def test_a_partial_look_is_softened_by_its_own_temperature(regime_artifacts: Path) -> None:
    recognizer = SketchRecognizer(regime_artifacts)
    assert recognizer.certain_above == CertaintyFloors(0.8, None)
    finished = recognizer.recognize(SQUARE_POINTS)
    partial = recognizer.recognize(SQUARE_POINTS, partial=True)
    assert partial.labels == finished.labels
    assert partial.probs[0] < finished.probs[0]
    ratio = np.log(finished.probs[0] / finished.probs[1]) / np.log(
        partial.probs[0] / partial.probs[1]
    )
    assert ratio == pytest.approx(PARTIAL_TEMPERATURE / TINY_TEMPERATURE, rel=1e-6)


def test_the_sidecar_states_the_floor_of_the_regime_it_was_asked_in(
    regime_artifacts: Path,
) -> None:
    with serving(regime_artifacts) as url:
        _, finished = call(f"{url}/recognize", {"strokes": SQUARE})
        _, partial = call(f"{url}/recognize", {"strokes": SQUARE, "partial": True})
    assert finished["certainAbove"] == 0.8
    assert "certainAbove" in partial and partial["certainAbove"] is None
    assert partial["probs"][0] < finished["probs"][0]


def test_the_sidecar_says_nothing_of_floors_for_a_model_without_them(sidecar_url: str) -> None:
    status, body = call(f"{sidecar_url}/recognize", {"strokes": SQUARE, "partial": True})
    assert status == 200
    assert set(body) == {"labels", "probs"}


@pytest.mark.parametrize(
    "extra",
    [
        {"temperaturePartial": 0},
        {"temperaturePartial": "1"},
        {"certainAbove": 0.8},
        {"certainAbove": {"finished": 1.5, "partial": None}},
        {"certainAbove": {"finished": True}},
    ],
)
def test_malformed_regime_fields_never_serve(
    tmp_path: Path, tiny_artifacts: Path, extra: dict[str, object]
) -> None:
    with pytest.raises(ValueError):
        SketchRecognizer(with_preprocess(tiny_artifacts, tmp_path / "tiny", extra))
