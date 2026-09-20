"""Choose each category's prototypical Quick, Draw! drawings with a trained model (CONTRACT.md).

python exemplars.py --model artifacts/<name> [--per-class 200] [--candidates-per-class 1500]
"""

from __future__ import annotations

import argparse
import time
from collections.abc import Iterator
from dataclasses import dataclass
from itertools import islice
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from exemplar_set import (
    EXEMPLARS_DIR,
    Exemplar,
    ExemplarSet,
    PointsU8,
    load_exemplars,
    model_sha256,
)
from quickdraw_bin import Drawing, category_path, read_drawings
from recognizer import SketchRecognizer
from render import from_xy_arrays, render, render_source_sha256

ML_DIR = Path(__file__).parent
DEFAULT_PER_CLASS = 200
DEFAULT_CANDIDATES_PER_CLASS = 1500
DEFAULT_MIN_PROBABILITY = 0.9
DEFAULT_THREADS = 6
BATCH_SIZE = 256
TYPICAL_OCTAVES = 1.0
PROGRESS_EVERY_CATEGORIES = 25


@dataclass(frozen=True, slots=True)
class Selection:
    per_class: int = DEFAULT_PER_CLASS
    candidates_per_class: int = DEFAULT_CANDIDATES_PER_CLASS
    min_probability: float = DEFAULT_MIN_PROBABILITY


@dataclass(frozen=True, slots=True)
class Candidates:
    """What selection looks at: one row per candidate drawing of a single category."""

    named_correctly: NDArray[np.bool_]
    probabilities: NDArray[np.float64]
    stroke_counts: NDArray[np.int64]
    point_counts: NDArray[np.int64]
    key_ids: NDArray[np.uint64]


@dataclass(frozen=True, slots=True)
class BuildReport:
    kept: dict[str, int]
    candidates: int
    seconds: float

    def short_of(self, per_class: int) -> dict[str, int]:
        return {category: count for category, count in self.kept.items() if count < per_class}


def octaves_from_median(counts: NDArray[np.int64]) -> NDArray[np.float64]:
    return np.asarray(np.abs(np.log2(counts / np.median(counts))), dtype=np.float64)


def select(candidates: Candidates, selection: Selection) -> NDArray[np.intp]:
    """Rows of the exemplars, best first: sure, typical, then by probability.

    Typical means stroke and point counts within a factor of two of the category's medians.
    """
    atypicality = np.maximum(
        octaves_from_median(candidates.stroke_counts), octaves_from_median(candidates.point_counts)
    )
    eligible = (
        candidates.named_correctly
        & (candidates.probabilities >= selection.min_probability)
        & (atypicality <= TYPICAL_OCTAVES)
    )
    best_first = np.lexsort((candidates.key_ids, atypicality, -candidates.probabilities))
    return best_first[eligible[best_first]][: selection.per_class]


def inked_strokes(drawing: Drawing) -> list[PointsU8]:
    return [np.stack([xs, ys], axis=1) for xs, ys in drawing.strokes if len(xs) > 0]


def is_placeable(drawing: Drawing) -> bool:
    """Recognised by Quick, Draw!, and with a bounding box that can be fitted somewhere."""
    strokes = inked_strokes(drawing)
    return drawing.recognized and bool(strokes) and bool(np.ptp(np.concatenate(strokes), 0).any())


def _batches(drawings: list[Drawing]) -> Iterator[list[Drawing]]:
    return (drawings[start : start + BATCH_SIZE] for start in range(0, len(drawings), BATCH_SIZE))


def category_exemplars(
    recognizer: SketchRecognizer, bin_path: Path, label: int, selection: Selection
) -> tuple[list[Exemplar], int]:
    """The category's exemplars, best first, and how many candidates were read."""
    if not bin_path.exists():
        return [], 0
    drawings = list(
        islice(filter(is_placeable, read_drawings(bin_path)), selection.candidates_per_class)
    )
    if not drawings:
        return [], 0
    inked = [inked_strokes(drawing) for drawing in drawings]
    readings = [
        recognizer.read_images(
            np.stack([render(from_xy_arrays(drawing.strokes)) for drawing in batch])
        )
        for batch in _batches(drawings)
    ]
    probabilities = np.concatenate([reading.probabilities for reading in readings])
    embeddings = np.concatenate([reading.embeddings for reading in readings])
    candidates = Candidates(
        named_correctly=probabilities.argmax(axis=1) == label,
        probabilities=probabilities[:, label],
        stroke_counts=np.asarray([len(strokes) for strokes in inked], dtype=np.int64),
        point_counts=np.asarray(
            [sum(len(stroke) for stroke in strokes) for strokes in inked], dtype=np.int64
        ),
        key_ids=np.asarray([drawing.key_id for drawing in drawings], dtype=np.uint64),
    )
    exemplars = [
        Exemplar(
            label=label,
            probability=float(candidates.probabilities[row]),
            key_id=drawings[row].key_id,
            embedding=embeddings[row].copy(),
            strokes=inked[row],
        )
        for row in select(candidates, selection)
    ]
    return exemplars, len(drawings)


def build_exemplars(
    recognizer: SketchRecognizer, bin_dir: Path, selection: Selection
) -> tuple[ExemplarSet, BuildReport]:
    started = time.perf_counter()
    exemplars: list[Exemplar] = []
    kept: dict[str, int] = {}
    candidates = 0
    for label, category in enumerate(recognizer.labels):
        chosen, read = category_exemplars(
            recognizer, category_path(bin_dir, category), label, selection
        )
        exemplars += chosen
        kept[category] = len(chosen)
        candidates += read
        if (label + 1) % PROGRESS_EVERY_CATEGORIES == 0:
            elapsed = time.perf_counter() - started
            print(f"  {label + 1}/{len(recognizer.labels)} categories, {elapsed:.0f} s", flush=True)
    report = BuildReport(kept, candidates, time.perf_counter() - started)
    return ExemplarSet.of(recognizer.labels, exemplars), report


def write_exemplars(
    model_dir: Path, bin_dir: Path, selection: Selection, threads: int | None = DEFAULT_THREADS
) -> BuildReport:
    exemplar_set, report = build_exemplars(
        SketchRecognizer(model_dir, threads=threads), bin_dir, selection
    )
    exemplar_set.save(
        model_dir / EXEMPLARS_DIR,
        {
            "modelSha256": model_sha256(model_dir),
            "renderSha256": render_source_sha256(),
            "perClass": selection.per_class,
            "candidatesPerClass": selection.candidates_per_class,
            "minProbability": selection.min_probability,
            "typicalOctaves": TYPICAL_OCTAVES,
        },
    )
    return report


def print_summary(model_dir: Path, selection: Selection, report: BuildReport) -> None:
    directory = model_dir / EXEMPLARS_DIR
    started = time.perf_counter()
    loaded = load_exemplars(directory)
    load_ms = (time.perf_counter() - started) * 1000
    size_mb = sum(path.stat().st_size for path in directory.iterdir()) / 1e6
    short = report.short_of(selection.per_class)
    rate = report.candidates / report.seconds if report.seconds > 0 else 0.0
    print(
        f"{loaded.count} exemplars for {len(report.kept) - len(short)}/{len(report.kept)} full "
        f"categories from {report.candidates} candidates in {report.seconds:.0f} s "
        f"({rate:.0f} drawings/s)"
    )
    print(
        f"{directory}: {size_mb:.1f} MB in {len(loaded.points)} points, loads in {load_ms:.0f} ms"
    )
    if short:
        listed = ", ".join(f"{category} {count}" for category, count in sorted(short.items()))
        print(f"{len(short)} categories short of {selection.per_class}: {listed}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="an artifacts/<name> directory")
    parser.add_argument("--per-class", type=int, default=DEFAULT_PER_CLASS)
    parser.add_argument("--candidates-per-class", type=int, default=DEFAULT_CANDIDATES_PER_CLASS)
    parser.add_argument("--min-probability", type=float, default=DEFAULT_MIN_PROBABILITY)
    parser.add_argument("--threads", type=int, default=DEFAULT_THREADS, help="ONNX Runtime threads")
    parser.add_argument("--data-dir", type=Path, default=ML_DIR / "data", help="holds bin/*.bin")
    parsed = parser.parse_args()
    selection = Selection(parsed.per_class, parsed.candidates_per_class, parsed.min_probability)
    report = write_exemplars(parsed.model, parsed.data_dir / "bin", selection, parsed.threads)
    print_summary(parsed.model, selection, report)


if __name__ == "__main__":
    main()
