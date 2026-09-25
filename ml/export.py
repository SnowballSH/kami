"""Write a trained SketchNet as the artefact directory that ml/CONTRACT.md describes."""

from __future__ import annotations

import json
import math
import warnings
from collections import Counter
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field
from itertools import islice
from pathlib import Path

import torch

from artifacts import (
    LABELS_FILE,
    MODEL_FILE,
    PREPROCESS_FILE,
    CertaintyFloors,
    publish_bundle,
    seal_bundle,
)
from calibrate import RegimeTemperatures
from metrics import Accuracy
from model import SketchNet
from quickdraw_bin import category_path, read_drawings
from recognizer import (
    INPUT_NAME,
    OUTPUT_NAMES,
    SketchRecognizer,
)
from render import (
    CANVAS,
    MARGIN,
    SIZE,
    THICKNESS,
    PointArray,
    from_xy_arrays,
    image_sha256,
    render,
    render_source_sha256,
    take_prefix,
)
from splits import Split, split_of

GOLDEN_FILE = "golden.json"
GOLDEN_CASES = 50
GOLDEN_TOP = 3
GOLDEN_PREFIX_FRACTIONS = (0.35, 0.5, 0.65, 0.8)
ONNX_OPSET = 17
BATCH_AXIS = {0: "batch"}
CHECKPOINT_FILE = "model.pt"
FLOOR_DECIMALS = 4


@dataclass(frozen=True, slots=True)
class TrainingSummary:
    """`selection`, `recipe` and `training` are free-form records kept beside the contract's fields:
    the selection metric on validation, the flags of the run, and how the fit went."""

    trained_on: str
    temperatures: RegimeTemperatures
    certain_above: CertaintyFloors
    validation: dict[str, Accuracy]
    test: dict[str, Accuracy]
    selection: Mapping[str, object] = field(default_factory=dict)
    recipe: Mapping[str, object] = field(default_factory=dict)
    training: Mapping[str, object] = field(default_factory=dict)


def conservative_floors(finished: float | None, partial: float | None) -> CertaintyFloors:
    """Floors rounded up, so the shipped number never promises more than was measured."""

    def round_up(floor: float | None) -> float | None:
        if floor is None:
            return None
        return float(min(1.0, math.ceil(floor * 10**FLOOR_DECIMALS) / 10**FLOOR_DECIMALS))

    return CertaintyFloors(round_up(finished), round_up(partial))


def json_safe(value: object) -> object:
    """NaN is not JSON: an empty bucket's accuracy is written as null."""
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, Mapping):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [json_safe(item) for item in value]
    return value


def export_onnx(model: SketchNet, path: Path) -> None:
    model = model.cpu().eval()
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        torch.onnx.export(
            model,
            (torch.zeros(1, 1, SIZE, SIZE),),
            str(path),
            input_names=[INPUT_NAME],
            output_names=OUTPUT_NAMES,
            dynamic_axes={name: BATCH_AXIS for name in [INPUT_NAME, *OUTPUT_NAMES]},
            opset_version=ONNX_OPSET,
            dynamo=False,
        )


def _preprocess(model: SketchNet, summary: TrainingSummary) -> dict[str, object]:
    overall = summary.test["overall"]
    return {
        "size": SIZE,
        "canvas": CANVAS,
        "margin": MARGIN,
        "thickness": THICKNESS,
        "temperature": summary.temperatures.finished,
        "temperaturePartial": summary.temperatures.partial,
        "temperaturePooled": summary.temperatures.pooled,
        "certainAbove": summary.certain_above.to_json(),
        "renderSha256": render_source_sha256(),
        "arch": model.arch.value,
        "trainedOn": summary.trained_on,
        "top1": overall.top1,
        "top3": overall.top3,
        "validation": {name: asdict(result) for name, result in summary.validation.items()},
        "test": {name: asdict(result) for name, result in summary.test.items()},
        "selection": summary.selection,
        "recipe": summary.recipe,
        "training": summary.training,
    }


def _as_json_strokes(strokes: list[PointArray]) -> list[list[dict[str, float]]]:
    return [[{"x": float(x), "y": float(y)} for x, y in points] for points in strokes]


def _golden_cases(
    recognizer: SketchRecognizer, categories: tuple[str, ...], bin_dir: Path
) -> list[dict[str, object]]:
    """Held-out drawings spread over the categories, every other one cut to a prefix."""
    wanted = Counter(
        categories[case * len(categories) // GOLDEN_CASES] for case in range(GOLDEN_CASES)
    )
    cases: list[dict[str, object]] = []
    for category, count in wanted.items():
        held_out = (
            drawing
            for drawing in read_drawings(category_path(bin_dir, category))
            if drawing.recognized and split_of(drawing.key_id) is Split.TEST
        )
        for drawing in islice(held_out, count):
            fraction = (
                GOLDEN_PREFIX_FRACTIONS[len(cases) // 2 % len(GOLDEN_PREFIX_FRACTIONS)]
                if len(cases) % 2
                else 1.0
            )
            strokes = take_prefix(from_xy_arrays(drawing.strokes), fraction)
            recognition = recognizer.recognize(strokes, GOLDEN_TOP)
            cases.append(
                {
                    "strokes": _as_json_strokes(strokes),
                    "imageSha256": image_sha256(render(strokes)),
                    "top3": recognition.labels,
                    "probs": recognition.probs,
                    "label": category,
                    "fraction": fraction,
                }
            )
    return cases


def write_artifacts(
    model: SketchNet,
    categories: tuple[str, ...],
    summary: TrainingSummary,
    bin_dir: Path,
    artifacts_dir: Path,
) -> None:
    def build(staging: Path) -> None:
        torch.save(model.state_dict(), staging / CHECKPOINT_FILE)
        export_onnx(model, staging / MODEL_FILE)
        (staging / LABELS_FILE).write_text(json.dumps(list(categories), indent=2))
        preprocess = json_safe(_preprocess(model, summary))
        (staging / PREPROCESS_FILE).write_text(json.dumps(preprocess, indent=2, allow_nan=False))
        golden = _golden_cases(SketchRecognizer(staging), categories, bin_dir)
        (staging / GOLDEN_FILE).write_text(json.dumps(golden))
        seal_bundle(staging)

    publish_bundle(artifacts_dir, build)
