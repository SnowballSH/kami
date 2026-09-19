"""Write a trained SketchNet as the artefact directory that ml/CONTRACT.md describes."""

from __future__ import annotations

import json
import warnings
from collections import Counter
from dataclasses import asdict, dataclass
from itertools import islice
from pathlib import Path

import torch

from dataset import Split, split_of
from metrics import Accuracy
from model import SketchNet
from quickdraw_bin import category_path, read_drawings
from recognizer import (
    INPUT_NAME,
    LABELS_FILE,
    MODEL_FILE,
    OUTPUT_NAMES,
    PREPROCESS_FILE,
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

GOLDEN_FILE = "golden.json"
GOLDEN_CASES = 50
GOLDEN_TOP = 3
GOLDEN_PREFIX_FRACTIONS = (0.35, 0.5, 0.65, 0.8)
ONNX_OPSET = 17
BATCH_AXIS = {0: "batch"}


@dataclass(frozen=True, slots=True)
class TrainingSummary:
    trained_on: str
    temperature: float
    validation: dict[str, Accuracy]
    test: dict[str, Accuracy]


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


def _preprocess(summary: TrainingSummary) -> dict[str, object]:
    overall = summary.test["overall"]
    return {
        "size": SIZE,
        "canvas": CANVAS,
        "margin": MARGIN,
        "thickness": THICKNESS,
        "temperature": summary.temperature,
        "renderSha256": render_source_sha256(),
        "trainedOn": summary.trained_on,
        "top1": overall.top1,
        "top3": overall.top3,
        "validation": {name: asdict(result) for name, result in summary.validation.items()},
        "test": {name: asdict(result) for name, result in summary.test.items()},
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
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    export_onnx(model, artifacts_dir / MODEL_FILE)
    (artifacts_dir / LABELS_FILE).write_text(json.dumps(list(categories), indent=2))
    (artifacts_dir / PREPROCESS_FILE).write_text(json.dumps(_preprocess(summary), indent=2))
    golden = _golden_cases(SketchRecognizer(artifacts_dir), categories, bin_dir)
    (artifacts_dir / GOLDEN_FILE).write_text(json.dumps(golden))
