"""Losses, batches, architectures, calibration regimes, the selection metric, the teacher store."""

from pathlib import Path

import numpy as np
import onnxruntime as ort
import pytest

torch = pytest.importorskip("torch")

import torch.nn.functional as F  # noqa: E402
from test_dataset import CATEGORIES, SAMPLES_PER_CLASS, write_synthetic_bins  # noqa: E402

from batches import PairedEpochs, paired_rows, sequential_rows, shuffled_rows  # noqa: E402
from calibrate import RegimeTemperatures, fit_regime_temperatures  # noqa: E402
from dataset import DatasetSpec, SketchDataset, Split, build_dataset  # noqa: E402
from export import conservative_floors, export_onnx, json_safe  # noqa: E402
from folding import FoldMap  # noqa: E402
from losses import Distillation, Objective, alignment_loss, distillation_loss  # noqa: E402
from model import EMBEDDING_SIZE, Arch, SketchNet  # noqa: E402
from render import SIZE  # noqa: E402
from retrieval import own_drawing_recall  # noqa: E402
from selection import selection_report  # noqa: E402
from teacher import TeacherLogits  # noqa: E402
from views import (  # noqa: E402
    FINISHED_VIEW,
    STRATIFIED_VIEW_COUNT,
    ViewPlan,
    ViewPolicy,
    ViewSampler,
)

CLASS_COUNT = 5
EARLY_WEIGHTS = (0.40, 0.28, 0.22, 0.10)


@pytest.fixture(scope="module")
def stratified(tmp_path_factory: pytest.TempPathFactory) -> SketchDataset:
    root = tmp_path_factory.mktemp("stratified")
    write_synthetic_bins(root / "bin")
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS, views=STRATIFIED_VIEW_COUNT)
    return build_dataset(spec, root / "bin", root / "out", workers=2)


def test_distillation_is_zero_for_the_teachers_own_logits_and_grows_with_disagreement() -> None:
    teacher = torch.randn(16, CLASS_COUNT)
    assert float(distillation_loss(teacher.clone(), teacher, 2.0)) == pytest.approx(0, abs=1e-6)
    assert float(distillation_loss(-teacher, teacher, 2.0)) > 0.1
    shifted = teacher + 7.0
    assert float(distillation_loss(shifted, teacher, 2.0)) == pytest.approx(0, abs=1e-5)


def test_distillation_matches_its_definition() -> None:
    student, teacher, tau = torch.randn(8, CLASS_COUNT), torch.randn(8, CLASS_COUNT), 2.0
    target = F.softmax(teacher / tau, dim=1)
    by_hand = (target * (target.log() - F.log_softmax(student / tau, dim=1))).sum(dim=1).mean()
    assert float(distillation_loss(student, teacher, tau)) == pytest.approx(
        float(by_hand) * tau**2, rel=1e-5
    )


def test_alignment_moves_only_the_prefix() -> None:
    prefix = torch.randn(6, EMBEDDING_SIZE, requires_grad=True)
    finished = torch.randn(6, EMBEDDING_SIZE, requires_grad=True)
    loss = alignment_loss(prefix, finished)
    loss.backward()
    assert prefix.grad is not None and float(prefix.grad.abs().sum()) > 0
    assert finished.grad is None
    assert float(alignment_loss(finished.detach() * 3, finished)) == pytest.approx(0, abs=1e-6)


def test_the_default_objective_is_label_smoothed_cross_entropy() -> None:
    logits, labels = torch.randn(12, CLASS_COUNT), torch.randint(0, CLASS_COUNT, (12,))
    embedding = torch.randn(12, EMBEDDING_SIZE)
    loss = Objective(label_smoothing=0.1)(logits, embedding, labels, None, False)
    assert float(loss) == pytest.approx(float(F.cross_entropy(logits, labels, label_smoothing=0.1)))


def test_the_full_objective_adds_its_terms_and_refuses_missing_inputs() -> None:
    logits, labels = torch.randn(12, CLASS_COUNT), torch.randint(0, CLASS_COUNT, (12,))
    teacher, embedding = torch.randn(12, CLASS_COUNT), torch.randn(12, EMBEDDING_SIZE)
    objective = Objective(0.0, Distillation(alpha=0.7, temperature=2.0), embed_align=0.5)
    finished, prefix = embedding.chunk(2)
    expected = (
        0.3 * F.cross_entropy(logits, labels)
        + 0.7 * distillation_loss(logits, teacher, 2.0)
        + 0.5 * alignment_loss(prefix, finished)
    )
    assert float(objective(logits, embedding, labels, teacher, True)) == pytest.approx(
        float(expected), rel=1e-5
    )
    with pytest.raises(ValueError):
        objective(logits, embedding, labels, None, True)
    with pytest.raises(ValueError):
        objective(logits, embedding, labels, teacher, False)
    with pytest.raises(ValueError):
        Distillation(alpha=1.5, temperature=2.0)


def test_single_view_epochs_are_the_batches_of_the_first_recipe() -> None:
    indices = np.arange(3, 1000, 3, dtype=np.int64)
    sampler = ViewSampler(ViewPlan(), 1000, seed=0)
    rows = shuffled_rows(indices, 64, np.random.default_rng(5), sampler, 1000)
    order = np.random.default_rng(5).permutation(indices)
    legacy = [np.sort(order[start : start + 64]) for start in range(0, len(order), 64)]
    assert len(rows) == len(legacy)
    for batch_rows, chunk in zip(rows, legacy, strict=True):
        assert np.array_equal(batch_rows.indices, chunk)
        assert not batch_rows.views.any() and not batch_rows.paired


def test_shuffled_rows_carry_each_drawings_view() -> None:
    indices = np.arange(0, 400, 2, dtype=np.int64)
    plan = ViewPlan(EARLY_WEIGHTS, ViewPolicy.FIXED)
    expected = ViewSampler(plan, 400, seed=3).views(np.arange(400, dtype=np.int64))
    rows = shuffled_rows(indices, 32, np.random.default_rng(0), ViewSampler(plan, 400, 3), 400)
    assert sorted(np.concatenate([batch.indices for batch in rows]).tolist()) == indices.tolist()
    for batch in rows:
        assert np.array_equal(batch.views, expected[batch.indices])


def test_paired_epochs_cover_every_drawing_once_in_two_epochs() -> None:
    indices = np.arange(101, dtype=np.int64)
    pairs = PairedEpochs(indices, np.random.default_rng(0))
    first, second = pairs.next_drawings(), pairs.next_drawings()
    assert len(first) == len(second) == pairs.drawings_per_epoch == 50
    assert len(set(first.tolist()) | set(second.tolist())) == 100
    assert not np.array_equal(np.sort(pairs.next_drawings()), np.sort(first))


def test_a_paired_batch_is_each_drawing_finished_then_as_a_prefix() -> None:
    sampler = ViewSampler(ViewPlan(EARLY_WEIGHTS, ViewPolicy.RESAMPLE), 200, seed=0)
    rows = paired_rows(np.arange(0, 200, 2, dtype=np.int64), 32, sampler, 200)
    assert sum(len(batch.indices) for batch in rows) == 200
    for batch in rows:
        half = len(batch.indices) // 2
        assert batch.paired and len(batch.indices) <= 32
        assert np.array_equal(batch.indices[:half], batch.indices[half:])
        assert np.all(batch.views[:half] == FINISHED_VIEW)
        assert np.all(batch.views[half:] > FINISHED_VIEW)


def test_sequential_rows_keep_the_order_and_the_view() -> None:
    rows = sequential_rows(np.arange(10, dtype=np.int64), 2, 4)
    assert [batch.indices.tolist() for batch in rows] == [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]
    assert all((batch.views == 2).all() for batch in rows)


@pytest.mark.parametrize("arch", list(Arch))
def test_every_architecture_keeps_the_contracts_tensors(arch: Arch, tmp_path: Path) -> None:
    model = SketchNet(CLASS_COUNT, arch).eval()
    images = torch.rand(2, 1, SIZE, SIZE)
    with torch.inference_mode():
        logits, embedding = model(images)
    assert logits.shape == (2, CLASS_COUNT) and embedding.shape == (2, EMBEDDING_SIZE)

    path = tmp_path / "model.onnx"
    export_onnx(model, path)
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    assert [node.name for node in session.get_inputs()] == ["image"]
    assert [node.name for node in session.get_outputs()] == ["logits", "embedding"]
    onnx_logits, _ = session.run(["logits", "embedding"], {"image": images.numpy()})
    assert np.allclose(onnx_logits, logits.numpy(), atol=1e-4)


def test_resnet18d_reads_full_resolution_and_pools_before_its_shortcuts() -> None:
    plain, deep = SketchNet(CLASS_COUNT), SketchNet(CLASS_COUNT, Arch.RESNET18D)
    assert deep.backbone.conv1[0].stride == (1, 1) and deep.backbone.conv1[-1].stride == (2, 2)
    for stage in (deep.backbone.layer2, deep.backbone.layer3, deep.backbone.layer4):
        pool, projection, _ = stage[0].downsample
        assert isinstance(pool, torch.nn.AvgPool2d) and projection.stride == (1, 1)
    extra = sum(p.numel() for p in deep.parameters()) - sum(p.numel() for p in plain.parameters())
    assert 0 < extra < 25_000


def test_the_default_architecture_has_the_weights_of_the_first_recipe() -> None:
    torch.manual_seed(0)
    default = SketchNet(CLASS_COUNT).state_dict()
    torch.manual_seed(0)
    named = SketchNet(CLASS_COUNT, Arch.RESNET18).state_dict()
    assert list(default) == list(named)
    assert "backbone.conv1.weight" in default and default["backbone.conv1.weight"].shape[1] == 1
    assert all(torch.equal(default[key], named[key]) for key in default)


def test_regime_temperatures_are_fitted_apart() -> None:
    rng = np.random.default_rng(3)
    true_logits = rng.normal(0, 2, (6000, CLASS_COUNT)).astype(np.float32)
    probabilities = np.exp(true_logits) / np.exp(true_logits).sum(axis=1, keepdims=True)
    labels = np.asarray([rng.choice(CLASS_COUNT, p=row) for row in probabilities], dtype=np.int64)
    partial = np.arange(6000) % 2 == 1
    logits = np.where(partial[:, None], true_logits * 3, true_logits * 0.5).astype(np.float32)
    temperatures = fit_regime_temperatures(logits, labels, partial)
    assert temperatures.finished == pytest.approx(0.5, rel=0.1)
    assert temperatures.partial == pytest.approx(3.0, rel=0.1)
    assert temperatures.finished < temperatures.pooled < temperatures.partial
    assert temperatures.of(np.asarray([True, False], dtype=np.bool_)).tolist() == [
        temperatures.partial,
        temperatures.finished,
    ]
    only_finished = fit_regime_temperatures(logits[~partial], labels[~partial], partial[~partial])
    assert only_finished.partial == only_finished.pooled


def test_own_drawing_recall_counts_prefixes_that_find_their_finished_drawing() -> None:
    rng = np.random.default_rng(0)
    finished = rng.normal(size=(40, 16)).astype(np.float32)
    labels = np.repeat(np.arange(2), 20).astype(np.int64)
    assert own_drawing_recall(finished * 2 + 0.01, finished, labels, k=1) == 1.0
    assert own_drawing_recall(finished, finished, labels, k=20) == 1.0
    shuffled = finished[rng.permutation(40)]
    assert own_drawing_recall(shuffled, finished, labels, k=1) < 0.3


def test_the_selection_score_is_the_designers_weighted_sum_on_folded_labels() -> None:
    labels_of = ("cake", "birthday cake", "cat")
    fold_map = FoldMap.of(labels_of, {"birthday cake": "cake"})
    fractions = np.asarray([1.0, 1.0, 0.6, 0.6, 0.4, 0.4], dtype=np.float32)
    labels = np.asarray([0, 2, 1, 2, 2, 0], dtype=np.int64)
    sure, unsure = 9.0, 0.5
    logits = np.asarray(
        [
            [0.0, sure, -sure],
            [-sure, -sure, sure],
            [sure, 0.0, -sure],
            [unsure, 0.0, 0.0],
            [0.0, unsure, 0.0],
            [sure, 0.0, 0.0],
        ],
        dtype=np.float32,
    )
    report = selection_report(
        logits, labels, fractions, RegimeTemperatures(1.0, 1.0, 1.0), fold_map, 0.5
    )
    assert report.folded_classes == 2
    assert (report.count_finished, report.count_mid, report.count_early) == (2, 2, 2)
    assert report.top1_finished == 1.0
    assert report.top1_mid == 0.5
    assert report.top3_early == 1.0
    assert report.cov95_finished == 1.0
    assert report.certain_above_finished is not None and report.certain_above_finished > 0.99
    assert report.score == pytest.approx(100 * (0.35 + 0.25 * 0.5 + 0.20 + 0.20))
    assert report.retrieval_recall_at_10 == 0.5
    unfolded = selection_report(
        logits, labels, fractions, RegimeTemperatures(1.0, 1.0, 1.0), FoldMap.identity(labels_of)
    )
    assert unfolded.top1_finished == 0.5


def test_a_softer_partial_temperature_lowers_partial_confidence_only() -> None:
    rng = np.random.default_rng(1)
    logits = rng.normal(0, 3, (400, 4)).astype(np.float32)
    labels = logits.argmax(axis=1).astype(np.int64)
    fractions = np.asarray([1.0, 0.6, 1.0, 0.4] * 100, dtype=np.float32)
    fold_map = FoldMap.identity(("a", "b", "c", "d"))
    sharp = selection_report(logits, labels, fractions, RegimeTemperatures(1, 1, 1), fold_map)
    soft = selection_report(logits, labels, fractions, RegimeTemperatures(1, 4, 1), fold_map)
    assert soft.ece_finished == sharp.ece_finished
    assert soft.ece_partial > sharp.ece_partial
    assert soft.score == pytest.approx(sharp.score)


def test_floors_are_rounded_up_and_nan_is_written_as_null() -> None:
    floors = conservative_floors(0.80123, None)
    assert floors.finished == 0.8013 and floors.partial is None
    assert conservative_floors(0.99999, 0.5).finished == 1.0
    assert json_safe({"a": float("nan"), "b": [1.0, float("inf")], "c": {"d": 2}}) == {
        "a": None,
        "b": [1.0, None],
        "c": {"d": 2},
    }


def test_teacher_logits_are_tied_to_their_dataset(
    stratified: SketchDataset, tmp_path: Path
) -> None:
    path = tmp_path / "teachers" / "peer.npy"
    logits = TeacherLogits.create(path, "peer", stratified)
    train = stratified.indices(Split.TRAIN)
    logits[train] = np.arange(len(train), dtype=np.float16)[:, None]
    del logits

    teacher = TeacherLogits.load(path, stratified)
    assert teacher.name == "peer"
    assert teacher.logits.shape == (len(stratified.labels), len(CATEGORIES))
    assert teacher.rows(train[:3]).tolist() == [[0.0, 0.0], [1.0, 1.0], [2.0, 2.0]]

    other = SketchDataset(
        stratified.categories,
        stratified.images,
        stratified.labels,
        stratified.fractions,
        stratified.splits,
        stratified.key_ids[::-1].copy(),
    )
    with pytest.raises(ValueError):
        TeacherLogits.load(path, other)
