"""The report's GX10 scripts (docs/reports/figures/src) on a few synthetic drawings, on the CPU:
they must keep reading whatever layout `dataset.py` writes."""

import importlib.util
import json
from dataclasses import asdict
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from test_dataset import CATEGORIES, SAMPLES_PER_CLASS, write_synthetic_bins  # noqa: E402

from artifacts import LABELS_FILE, PREPROCESS_FILE  # noqa: E402
from dataset import DatasetSpec, SketchDataset, Split, build_dataset  # noqa: E402
from evaluation import evaluate_split  # noqa: E402
from export import CHECKPOINT_FILE  # noqa: E402
from metrics import FULL_BUCKET, OVERALL_BUCKET, Accuracy, bucketed_accuracy  # noqa: E402
from model import SketchNet  # noqa: E402
from views import STRATIFIED_VIEW_COUNT  # noqa: E402

SCRIPTS = Path(__file__).resolve().parents[2] / "docs" / "reports" / "figures" / "src"
CPU = torch.device("cpu")
BATCH_SIZE = 16
TEMPERATURE = 0.9
TEMPERATURE_PARTIAL = 1.4

pytestmark = pytest.mark.skipif(
    not SCRIPTS.is_dir(), reason="the report scripts live in docs/, outside the box's copy of ml/"
)


def load_script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def root(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("report")
    write_synthetic_bins(directory / "bin")
    return directory


@pytest.fixture(scope="module")
def single_dir(root: Path) -> Path:
    build_dataset(DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS), root / "bin", root / "one")
    return root / "one"


@pytest.fixture(scope="module")
def stratified_dir(root: Path) -> Path:
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS, views=STRATIFIED_VIEW_COUNT)
    build_dataset(spec, root / "bin", root / "four", workers=2)
    return root / "four"


@pytest.fixture(scope="module")
def model_dir(root: Path) -> Path:
    directory = root / "model"
    directory.mkdir()
    torch.manual_seed(0)
    torch.save(SketchNet(len(CATEGORIES)).state_dict(), directory / CHECKPOINT_FILE)
    (directory / LABELS_FILE).write_text(json.dumps(CATEGORIES))
    (directory / PREPROCESS_FILE).write_text(
        json.dumps({"temperature": TEMPERATURE, "temperaturePartial": TEMPERATURE_PARTIAL})
    )
    return directory


def held_out_count(dataset: SketchDataset) -> int:
    return int((dataset.splits != Split.TRAIN).sum()) * dataset.view_count


def as_records(report: dict[str, Accuracy]) -> dict[str, dict[str, float]]:
    return {bucket: asdict(result) for bucket, result in report.items()}


@pytest.mark.parametrize("dataset_fixture", ["single_dir", "stratified_dir"])
def test_the_dump_keeps_one_row_per_held_out_view(
    dataset_fixture: str, model_dir: Path, tmp_path: Path, request: pytest.FixtureRequest
) -> None:
    script = load_script("evaluate_dump")
    dataset_dir: Path = request.getfixturevalue(dataset_fixture)
    out = tmp_path / "eval.npz"
    dataset = script.load_dataset(dataset_dir)
    script.dump(model_dir, dataset_dir, out, CPU, BATCH_SIZE)

    kept = np.load(out)
    rows = held_out_count(dataset)
    top = min(script.TOP, len(CATEGORIES))
    assert kept["split"].shape == kept["label"].shape == kept["fraction"].shape == (rows,)
    assert kept["top_classes"].shape == kept["top_probs"].shape == (rows, top)
    assert set(kept["split"].tolist()) == {int(Split.VAL), int(Split.TEST)}
    assert list(kept["categories"]) == list(CATEGORIES)
    assert np.all(np.diff(kept["top_probs"], axis=1) <= 0)

    test_rows = kept["split"] == Split.TEST
    model, _ = script.load_trained(model_dir, CPU)
    expected = evaluate_split(model, dataset, Split.TEST, BATCH_SIZE, CPU)
    assert np.array_equal(kept["label"][test_rows], expected.labels)
    assert np.array_equal(kept["fraction"][test_rows], expected.fractions)
    assert np.array_equal(kept["top_classes"][test_rows, 0], expected.logits.argmax(axis=1))
    temperatures = np.where(expected.partial, TEMPERATURE_PARTIAL, TEMPERATURE)[:, None]
    calibrated = torch.softmax(torch.from_numpy(expected.logits / temperatures), dim=1)
    assert np.allclose(kept["top_probs"][test_rows, 0], calibrated.max(dim=1).values.numpy())


@pytest.mark.parametrize("dataset_fixture", ["single_dir", "stratified_dir"])
def test_like_for_like_with_every_category_is_the_plain_test_report(
    dataset_fixture: str, model_dir: Path, request: pytest.FixtureRequest
) -> None:
    script = load_script("like_for_like")
    dataset_dir: Path = request.getfixturevalue(dataset_fixture)
    dataset = script.load_dataset(dataset_dir)
    report = script.like_for_like(model_dir, dataset_dir, CATEGORIES, CPU, BATCH_SIZE)

    model, _ = script.load_trained(model_dir, CPU)
    expected = evaluate_split(model, dataset, Split.TEST, BATCH_SIZE, CPU)
    plain = bucketed_accuracy(expected.logits, expected.labels, expected.fractions)
    np.testing.assert_equal(as_records(report), as_records(plain))
    assert report[OVERALL_BUCKET].count == int((dataset.splits == Split.TEST).sum()) * (
        dataset.view_count
    )


def test_like_for_like_answers_only_with_the_kept_categories(
    single_dir: Path, model_dir: Path
) -> None:
    script = load_script("like_for_like")
    dataset = script.load_dataset(single_dir)
    kept, unknown = CATEGORIES[0], "not a category"
    report = script.like_for_like(model_dir, single_dir, (kept, unknown), CPU, BATCH_SIZE)

    of_kept = (dataset.splits == Split.TEST) & (dataset.labels == CATEGORIES.index(kept))
    assert report[OVERALL_BUCKET].count == int(of_kept.sum()) > 0
    assert report[OVERALL_BUCKET].top1 == 1.0
    finished = of_kept & (dataset.fractions[:, 0] >= 1.0)
    assert report[FULL_BUCKET].count == int(finished.sum())
