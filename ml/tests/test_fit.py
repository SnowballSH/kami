"""The fit loop end to end on a few synthetic drawings (CPU): every option trains and reports."""

from pathlib import Path

import numpy as np
import pytest

torch = pytest.importorskip("torch")

from test_dataset import CATEGORIES, SAMPLES_PER_CLASS, write_synthetic_bins  # noqa: E402
from torch import Tensor  # noqa: E402

from dataset import DatasetSpec, SketchDataset, Split, build_dataset  # noqa: E402
from evaluation import evaluate_split  # noqa: E402
from loop import FitConfig, fit, predict  # noqa: E402
from losses import Distillation  # noqa: E402
from model import Arch, SketchNet  # noqa: E402
from teacher import TeacherLogits  # noqa: E402
from views import STRATIFIED_VIEW_COUNT, ViewPlan, ViewPolicy  # noqa: E402

CPU = torch.device("cpu")
EARLY_WEIGHTS = (0.40, 0.28, 0.22, 0.10)
BATCH_SIZE = 16


@pytest.fixture(scope="module")
def bins(tmp_path_factory: pytest.TempPathFactory) -> Path:
    root = tmp_path_factory.mktemp("fit")
    write_synthetic_bins(root / "bin")
    return root


@pytest.fixture(scope="module")
def single(bins: Path) -> SketchDataset:
    return build_dataset(DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS), bins / "bin", bins / "one")


@pytest.fixture(scope="module")
def stratified(bins: Path) -> SketchDataset:
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS, views=STRATIFIED_VIEW_COUNT)
    return build_dataset(spec, bins / "bin", bins / "four", workers=2)


def weights_of(model: SketchNet) -> list[Tensor]:
    return [parameter.detach().clone() for parameter in model.parameters()]


def test_the_default_fit_is_reproducible_and_reports_each_epoch(single: SketchDataset) -> None:
    def run() -> tuple[list[Tensor], float]:
        torch.manual_seed(0)
        model = SketchNet(len(CATEGORIES))
        result = fit(model, single, FitConfig(2, BATCH_SIZE, 1e-3, seed=0), CPU)
        assert [record.epoch for record in result.history] == [1, 2]
        assert result.images_per_second > 0 and not result.compiled
        return weights_of(model), result.history[-1].loss

    first, second = run(), run()
    assert first[1] == second[1]
    assert all(torch.equal(a, b) for a, b in zip(first[0], second[0], strict=True))


def test_view_weights_must_match_the_dataset(single: SketchDataset) -> None:
    config = FitConfig(1, BATCH_SIZE, 1e-3, seed=0, view_plan=ViewPlan(EARLY_WEIGHTS))
    with pytest.raises(ValueError):
        fit(SketchNet(len(CATEGORIES)), single, config, CPU)


def test_resampled_views_distillation_and_alignment_train_together(
    stratified: SketchDataset, tmp_path: Path
) -> None:
    torch.manual_seed(0)
    teacher_model = SketchNet(len(CATEGORIES))
    train = stratified.indices(Split.TRAIN)
    path = tmp_path / "peer.npy"
    logits = TeacherLogits.create(path, "peer", stratified)
    logits[train] = predict(teacher_model, stratified, train, BATCH_SIZE, CPU).logits.astype(
        np.float16
    )
    del logits

    student = SketchNet(len(CATEGORIES), Arch.RESNET18D)
    before = weights_of(student)
    config = FitConfig(
        epochs=2,
        batch_size=BATCH_SIZE,
        max_learning_rate=1e-3,
        seed=0,
        label_smoothing=0.0,
        view_plan=ViewPlan(EARLY_WEIGHTS, ViewPolicy.RESAMPLE),
        distillation=Distillation(0.7, 2.0),
        embed_align=0.5,
        readers=3,
    )
    result = fit(student, stratified, config, CPU, TeacherLogits.load(path, stratified))
    assert len(result.history) == 2 and np.isfinite(result.history[-1].loss)
    assert any(not torch.equal(a, b) for a, b in zip(before, weights_of(student), strict=True))
    with pytest.raises(ValueError):
        fit(student, stratified, config, CPU)


def test_a_failing_compiler_leaves_an_untouched_eager_model(
    stratified: SketchDataset, monkeypatch: pytest.MonkeyPatch
) -> None:
    def broken(*_: object, **__: object) -> None:
        raise RuntimeError("no compiler on this machine")

    monkeypatch.setattr(torch, "compile", broken)
    config = FitConfig(1, BATCH_SIZE, 1e-3, seed=0, view_plan=ViewPlan(EARLY_WEIGHTS), compile=True)
    result = fit(SketchNet(len(CATEGORIES)), stratified, config, CPU)
    assert not result.compiled and np.isfinite(result.history[0].loss)


def test_a_split_is_evaluated_view_by_view(stratified: SketchDataset) -> None:
    model = SketchNet(len(CATEGORIES))
    evaluation = evaluate_split(model, stratified, Split.VAL, BATCH_SIZE, CPU)
    val = stratified.indices(Split.VAL)
    assert evaluation.logits.shape == (len(val) * STRATIFIED_VIEW_COUNT, len(CATEGORIES))
    assert np.array_equal(evaluation.labels[: len(val)], stratified.labels[val])
    assert np.array_equal(evaluation.fractions[: len(val)], stratified.fractions[val, 0])
    assert np.array_equal(evaluation.fractions[-len(val) :], stratified.fractions[val, 3])
    assert evaluation.partial.sum() == 3 * len(val)
    assert evaluation.retrieval_recall_at_10 is not None


def test_a_single_view_split_has_no_retrieval_pairs(single: SketchDataset) -> None:
    evaluation = evaluate_split(SketchNet(len(CATEGORIES)), single, Split.VAL, BATCH_SIZE, CPU)
    assert evaluation.logits.shape[0] == len(single.indices(Split.VAL))
    assert evaluation.retrieval_recall_at_10 is None
