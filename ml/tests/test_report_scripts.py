"""The report's scripts (docs/reports/figures/src) on a few synthetic drawings, on the CPU: they
must keep reading held-out drawings the way the kit scores them."""

import importlib.util
import json
from dataclasses import asdict
from pathlib import Path
from types import ModuleType

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from synthetic import SYNTHETIC_CATEGORIES, write_synthetic_bins  # noqa: E402

from artifacts import LABELS_FILE, PREPROCESS_FILE  # noqa: E402
from export import CHECKPOINT_FILE  # noqa: E402
from kit.assess import read_held_out  # noqa: E402
from kit.corpus import Corpus, CorpusSpec  # noqa: E402
from kit.devices import Accelerator  # noqa: E402
from metrics import FULL_BUCKET, OVERALL_BUCKET, Accuracy, bucketed_accuracy  # noqa: E402
from model import SketchNet  # noqa: E402
from splits import Split  # noqa: E402

SCRIPTS = Path(__file__).resolve().parents[2] / "docs" / "reports" / "figures" / "src"
CPU = Accelerator.of("cpu")
HEAD = 50
TEMPERATURE = 0.9
TEMPERATURE_PARTIAL = 1.4

pytestmark = pytest.mark.skipif(not SCRIPTS.is_dir(), reason="the report scripts live in docs/")


def load_script(name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def corpus(tmp_path_factory: pytest.TempPathFactory) -> Corpus:
    root = tmp_path_factory.mktemp("report")
    write_synthetic_bins(root / "bin")
    return Corpus.build(CorpusSpec(SYNTHETIC_CATEGORIES, HEAD), root / "bin", root / "index")


@pytest.fixture(scope="module")
def model_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    directory = tmp_path_factory.mktemp("model")
    torch.manual_seed(0)
    torch.save(SketchNet(len(SYNTHETIC_CATEGORIES)).state_dict(), directory / CHECKPOINT_FILE)
    (directory / LABELS_FILE).write_text(json.dumps(SYNTHETIC_CATEGORIES))
    (directory / PREPROCESS_FILE).write_text(
        json.dumps({"temperature": TEMPERATURE, "temperaturePartial": TEMPERATURE_PARTIAL})
    )
    return directory


def as_records(report: dict[str, Accuracy]) -> dict[str, dict[str, float]]:
    return {bucket: asdict(result) for bucket, result in report.items()}


def test_the_dump_keeps_one_row_per_look_at_each_held_out_drawing(
    corpus: Corpus, model_dir: Path, tmp_path: Path
) -> None:
    script = load_script("evaluate_dump")
    out = tmp_path / "eval.npz"
    script.dump(model_dir, corpus, out, CPU, HEAD, workers=0)

    kept = np.load(out)
    held_out = sum(len(corpus.indices(split, HEAD)) for split in (Split.VAL, Split.TEST))
    top = min(script.TOP, len(SYNTHETIC_CATEGORIES))
    assert kept["split"].shape == kept["label"].shape == kept["fraction"].shape == (2 * held_out,)
    assert kept["top_classes"].shape == kept["top_probs"].shape == (2 * held_out, top)
    assert set(kept["split"].tolist()) == {int(Split.VAL), int(Split.TEST)}
    assert list(kept["categories"]) == list(SYNTHETIC_CATEGORIES)
    assert np.all(np.diff(kept["top_probs"], axis=1) <= 0)

    test_rows = kept["split"] == Split.TEST
    model, _ = script.load_trained(model_dir, CPU.device)
    expected = read_held_out(model, corpus, corpus.indices(Split.TEST, HEAD), CPU, 0)
    assert np.array_equal(kept["label"][test_rows], expected.labels)
    assert np.array_equal(kept["fraction"][test_rows], expected.fractions)
    assert np.array_equal(kept["top_classes"][test_rows, 0], expected.logits.argmax(axis=1))
    temperatures = np.where(expected.partial, TEMPERATURE_PARTIAL, TEMPERATURE)[:, None]
    calibrated = torch.softmax(torch.from_numpy(expected.logits / temperatures), dim=1)
    assert np.allclose(kept["top_probs"][test_rows, 0], calibrated.max(dim=1).values.numpy())


def test_like_for_like_with_every_category_is_the_plain_test_report(
    corpus: Corpus, model_dir: Path
) -> None:
    script = load_script("like_for_like")
    report = script.like_for_like(model_dir, corpus, SYNTHETIC_CATEGORIES, CPU, HEAD, workers=0)

    model, _ = script.load_trained(model_dir, CPU.device)
    expected = read_held_out(model, corpus, corpus.indices(Split.TEST, HEAD), CPU, 0)
    plain = bucketed_accuracy(expected.logits, expected.labels, expected.fractions)
    np.testing.assert_equal(as_records(report), as_records(plain))
    assert report[OVERALL_BUCKET].count == 2 * len(corpus.indices(Split.TEST, HEAD))


def test_like_for_like_answers_only_with_the_kept_categories(
    corpus: Corpus, model_dir: Path
) -> None:
    script = load_script("like_for_like")
    kept, unknown = SYNTHETIC_CATEGORIES[0], "not a category"
    report = script.like_for_like(model_dir, corpus, (kept, unknown), CPU, HEAD, workers=0)

    test = corpus.indices(Split.TEST, HEAD)
    of_kept = int((corpus.labels[test] == 0).sum())
    assert report[OVERALL_BUCKET].count == 2 * of_kept > 0
    assert report[OVERALL_BUCKET].top1 == 1.0
    assert report[FULL_BUCKET].count == of_kept
