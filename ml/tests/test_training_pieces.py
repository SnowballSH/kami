"""Architectures, calibration regimes, own-drawing recall, the selection metric, floors."""

from pathlib import Path

import numpy as np
import pytest

from onnx_runtime import ort

torch = pytest.importorskip("torch")

from calibrate import RegimeTemperatures, fit_regime_temperatures  # noqa: E402
from export import conservative_floors, export_onnx, json_safe  # noqa: E402
from folding import FoldMap  # noqa: E402
from model import EMBEDDING_SIZE, Arch, SketchNet  # noqa: E402
from render import SIZE  # noqa: E402
from retrieval import own_drawing_recall  # noqa: E402
from selection import selection_report  # noqa: E402

CLASS_COUNT = 5


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


def test_recall_can_ask_with_some_prefixes_against_every_finished_drawing() -> None:
    rng = np.random.default_rng(1)
    finished = rng.normal(size=(40, 16)).astype(np.float32)
    labels = np.repeat(np.arange(2), 20).astype(np.int64)
    prefixes = finished[rng.permutation(40)]
    prefixes[:5] = finished[:5]
    asking = np.arange(40) < 5
    assert own_drawing_recall(prefixes, finished, labels, k=1, queries=asking) == 1.0
    assert np.isnan(own_drawing_recall(prefixes, finished, labels, queries=np.zeros(40, bool)))


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
