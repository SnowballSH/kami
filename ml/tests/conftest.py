import json
import shutil
from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from serving import serving
from synthetic import EMPTY_CATEGORY, PER_CLASS, random_drawing
from tiny_model import TINY_LABELS, TINY_TEMPERATURE, build_tiny_model

from artifacts import seal_bundle
from exemplars import DEFAULT_MIN_PROBABILITY, Selection, write_exemplars
from quickdraw_bin import Drawing, category_path, write_drawings
from recognizer import SketchRecognizer
from render import CANVAS, MARGIN, SIZE, THICKNESS, from_xy_arrays, render, render_source_sha256

POOL_SIZE = 400


@pytest.fixture(scope="session")
def tiny_artifacts(tmp_path_factory: pytest.TempPathFactory) -> Path:
    artifacts_dir = tmp_path_factory.mktemp("artifacts") / "tiny"
    artifacts_dir.mkdir()
    build_tiny_model(artifacts_dir / "model.onnx")
    (artifacts_dir / "labels.json").write_text(json.dumps(TINY_LABELS))
    (artifacts_dir / "preprocess.json").write_text(
        json.dumps(
            {
                "temperature": TINY_TEMPERATURE,
                "renderSha256": render_source_sha256(),
                "size": SIZE,
                "canvas": CANVAS,
                "margin": MARGIN,
                "thickness": THICKNESS,
            }
        )
    )
    (artifacts_dir / "golden.json").write_text('[{"fixture": true}]')
    seal_bundle(artifacts_dir)
    return artifacts_dir


@pytest.fixture(scope="session")
def sidecar_url(tiny_artifacts: Path) -> Iterator[str]:
    with serving(tiny_artifacts) as url:
        yield url


@pytest.fixture(scope="session")
def sure_drawings(tiny_artifacts: Path) -> dict[str, list[Drawing]]:
    """Random drawings under the category the tiny model gives them with probability >= 0.9."""
    rng = np.random.default_rng(11)
    drawings = [random_drawing(rng, key_id) for key_id in range(1, POOL_SIZE + 1)]
    reading = SketchRecognizer(tiny_artifacts).read_images(
        np.stack([render(from_xy_arrays(drawing.strokes)) for drawing in drawings])
    )
    sure: dict[str, list[Drawing]] = {label: [] for label in TINY_LABELS}
    for drawing, probabilities in zip(drawings, reading.probabilities, strict=True):
        if probabilities.max() >= DEFAULT_MIN_PROBABILITY:
            sure[TINY_LABELS[int(probabilities.argmax())]].append(drawing)
    assert all(len(found) > PER_CLASS for found in sure.values())
    return sure


@pytest.fixture(scope="session")
def bin_dir(
    tmp_path_factory: pytest.TempPathFactory, sure_drawings: dict[str, list[Drawing]]
) -> Path:
    """One .bin per category the tiny model knows, except EMPTY_CATEGORY."""
    directory = tmp_path_factory.mktemp("bin")
    for category, drawings in sure_drawings.items():
        if category != EMPTY_CATEGORY:
            write_drawings(category_path(directory, category), drawings)
    return directory


@pytest.fixture(scope="session")
def completing_artifacts(
    tmp_path_factory: pytest.TempPathFactory, tiny_artifacts: Path, bin_dir: Path
) -> Path:
    artifacts_dir = tmp_path_factory.mktemp("completing") / "tiny"
    shutil.copytree(tiny_artifacts, artifacts_dir)
    write_exemplars(artifacts_dir, bin_dir, Selection(per_class=PER_CLASS), threads=1)
    return artifacts_dir


@pytest.fixture(scope="session")
def completing_sidecar_url(completing_artifacts: Path) -> Iterator[str]:
    with serving(completing_artifacts) as url:
        yield url
