"""The resumable trainer and the stages of retrain.py, end to end on a few synthetic drawings (CPU):
a run stopped and resumed learns exactly what an uninterrupted one does, and `all` leaves a
release the sidecar serves plus a package with honest checksums."""

import json
import tarfile
from dataclasses import replace
from itertools import pairwise
from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from synthetic import SYNTHETIC_CATEGORIES, write_synthetic_bins  # noqa: E402
from torch import Tensor  # noqa: E402

import retrain  # noqa: E402
from artifacts import PREPROCESS_FILE, validate_bundle  # noqa: E402
from kit.corpus import Corpus, CorpusSpec  # noqa: E402
from kit.devices import Accelerator  # noqa: E402
from kit.recipe import Recipe, Runtime  # noqa: E402
from kit.release import Package, publish  # noqa: E402
from kit.trainer import RunFiles, Trainer, learning_rate  # noqa: E402
from quickdraw_bin import MANIFEST_NAME  # noqa: E402
from recognizer import SketchRecognizer  # noqa: E402

PER_CLASS = 60
QUIET = Runtime(device="cpu", workers=0, probe_minutes=1e6, log_seconds=1e6)


def tiny_recipe() -> Recipe:
    return Recipe(
        SYNTHETIC_CATEGORIES,
        drawings_per_class=PER_CLASS,
        epochs=2,
        batch_size=8,
        learning_rate=1e-3,
        eval_head=PER_CLASS,
    )


def write_bins(data_dir: Path) -> None:
    """Bins that count as already downloaded, so no stage reaches for the network."""
    write_synthetic_bins(data_dir / "bin", per_category=PER_CLASS + 10)
    manifest = dict.fromkeys(SYNTHETIC_CATEGORIES, 10**12)
    (data_dir / "bin" / MANIFEST_NAME).write_text(json.dumps(manifest))


@pytest.fixture(scope="module")
def corpus(tmp_path_factory: pytest.TempPathFactory) -> Corpus:
    data = tmp_path_factory.mktemp("data")
    write_bins(data)
    return Corpus.build(tiny_recipe().corpus_spec(), data / "bin", data / "index", workers=1)


def weights(trainer: Trainer) -> list[Tensor]:
    return [tensor.clone() for tensor in trainer.model.state_dict().values()]


def test_the_learning_rate_warms_up_then_anneals_to_almost_nothing() -> None:
    rates = [learning_rate(step, 1000, 1e-3, 0.1) for step in range(1001)]
    assert rates[0] == pytest.approx(1e-3 / 25)
    assert max(rates) == pytest.approx(1e-3) and int(np.argmax(rates)) == 100
    assert all(a >= b for a, b in pairwise(rates[100:]))
    assert rates[-1] < 1e-8


def test_a_resumed_run_learns_exactly_what_an_uninterrupted_one_does(
    corpus: Corpus, tmp_path: Path
) -> None:
    accelerator = Accelerator.of("cpu")
    straight = Trainer(tiny_recipe(), corpus, RunFiles(tmp_path / "a"), accelerator, QUIET)
    straight.files.directory.mkdir()
    straight.fit()

    files = RunFiles(tmp_path / "b")
    files.directory.mkdir()
    paused = Trainer(tiny_recipe(), corpus, files, accelerator, QUIET)
    paused.fit(until=5)
    assert paused.step == 5 and files.checkpoint.exists()
    resumed = Trainer(tiny_recipe(), corpus, files, accelerator, QUIET)
    resumed.fit()

    assert resumed.step == straight.step == straight.plan.total_steps
    assert all(torch.equal(a, b) for a, b in zip(weights(straight), weights(resumed), strict=True))
    assert [record.epoch for record in resumed.clocks.history] == [1.0, 2.0]


def test_a_checkpoint_of_another_recipe_is_refused(corpus: Corpus, tmp_path: Path) -> None:
    files = RunFiles(tmp_path)
    Trainer(tiny_recipe(), corpus, files, Accelerator.of("cpu"), QUIET).fit(until=2)
    other = Trainer(replace(tiny_recipe(), seed=1), corpus, files, Accelerator.of("cpu"), QUIET)
    with pytest.raises(SystemExit):
        other.fit()


def test_a_recipe_survives_json_and_its_fingerprint_follows_its_content() -> None:
    recipe = tiny_recipe()
    assert Recipe.from_json(json.loads(json.dumps(recipe.to_json()))) == recipe
    assert replace(recipe, epochs=3).fingerprint() != recipe.fingerprint()
    assert recipe.corpus_spec() == CorpusSpec(SYNTHETIC_CATEGORIES, PER_CLASS)


def arguments_for(stage: str, root: Path, categories: Path, *extra: str) -> list[str]:
    return [
        stage,
        "--name",
        "tiny",
        "--data-dir",
        str(root / "data"),
        "--artifacts-dir",
        str(root / "artifacts"),
        "--categories",
        str(categories),
        "--drawings-per-class",
        str(PER_CLASS),
        "--eval-head",
        str(PER_CLASS),
        "--epochs",
        "2",
        "--batch-size",
        "8",
        "--device",
        "cpu",
        "--workers",
        "0",
        *extra,
    ]


def test_all_leaves_a_served_release_and_a_checksummed_package(tmp_path: Path) -> None:
    write_bins(tmp_path / "data")
    categories = tmp_path / "categories.txt"
    categories.write_text("\n".join(SYNTHETIC_CATEGORIES))
    retrain.main(arguments_for("all", tmp_path, categories, "--version", "t1"))

    release = tmp_path / "artifacts" / "tiny"
    assert release.is_symlink()
    validate_bundle(release.resolve())
    preprocess = json.loads((release / PREPROCESS_FILE).read_text())
    assert preprocess["temperature"] > 0 and preprocess["temperaturePartial"] > 0
    assert set(preprocess["certainAbove"]) == {"finished", "partial"}
    saved = json.loads((tmp_path / "artifacts" / "runs" / "tiny" / "recipe.json").read_text())
    assert preprocess["recipe"]["fingerprint"] == Recipe.from_json(saved).fingerprint()
    assert set(preprocess["test"]) >= {"finished", "prefix 30%-50%", "overall"}
    assert tuple(SketchRecognizer(release).labels) == SYNTHETIC_CATEGORIES

    package = Package(tmp_path / "artifacts" / "runs" / "tiny" / "package" / "t1", "t1")
    assert package.complete()
    sums = dict(line.split("  ")[::-1] for line in package.sums.read_text().splitlines())
    assert set(sums) == {package.bundle.name, package.weights.name, package.card.name}
    with tarfile.open(package.bundle) as bundle:
        names = set(bundle.getnames())
    assert "kami-eye-t1/model.onnx" in names and "kami-eye-t1/release.json" in names
    assert "kami-eye-t1/model.pt" not in names
    assert "| finished |" in package.card.read_text()

    exported = release.resolve()
    retrain.main(arguments_for("all", tmp_path, categories, "--version", "t1"))
    assert release.resolve() == exported
    with pytest.raises(SystemExit):
        retrain.main(arguments_for("train", tmp_path, categories, "--seed", "7"))


def test_publish_is_the_gh_release_of_the_package(tmp_path: Path) -> None:
    package = Package(tmp_path, "v9")
    for path in package.assets:
        path.write_text("x")
    command = publish(package, "owner/kami", dry_run=True)
    assert command.startswith("gh release create eye-v9 ")
    assert "--notes-file" in command and command.endswith("--repo owner/kami")
