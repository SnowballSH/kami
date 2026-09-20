"""Review the morph on Quick, Draw! test drawings: metrics.json, a printed table, contact sheets.

python morph_review.py --model <bundle dir> --data <quickdraw data dir> --out <dir>
    [--drawings 120] [--seed 7] [--categories a,b,c] [--threads 4]

Run it from inside the copy of ml/ whose morph is under review: it imports that copy's modules.
All measured lengths are shares of the player's bounding-box diagonal.
"""

from __future__ import annotations

import argparse
import json
import time
from collections.abc import Callable, Sequence
from dataclasses import asdict, dataclass, fields
from itertools import zip_longest
from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray

from completion import Completion, SketchCompleter
from dataset import Split, split_of
from exemplar_set import load_exemplars_of_model
from quickdraw_bin import Drawing, category_path, read_drawings
from recognizer import SketchRecognizer

Points = NDArray[np.float64]
Picture = NDArray[np.uint8]
Colour = tuple[int, int, int]
Variant = Callable[[list[Points], np.random.Generator], list[Points]]

DEFAULT_CATEGORIES = (
    "cat",
    "dog",
    "fish",
    "bird",
    "house",
    "tree",
    "ladder",
    "bridge",
    "car",
    "airplane",
    "sword",
    "key",
    "umbrella",
    "mushroom",
    "star",
    "cloud",
    "sun",
    "flower",
    "butterfly",
    "snake",
    "rabbit",
    "apple",
    "door",
    "table",
    "chair",
    "bicycle",
    "sailboat",
    "axe",
    "hammer",
    "bucket",
)
DEFAULT_DRAWINGS = 120
DEFAULT_SEED = 7
DEFAULT_THREADS = 4
FIRMNESSES = (0.5, 0.75, 1.0)

QUICKDRAW_SPAN = 255.0
WORLD_SPAN = 300.0
WORLD_CENTRE = np.array([400.0, 300.0])
PEN_SPACING = 4.0
MAX_PLAYER_POINTS = 1500

WOBBLE_AMPLITUDE = 0.02
WOBBLE_WAVES = 3
WOBBLE_WAVELENGTHS = (0.3, 1.0)
WOBBLE_STRETCH = np.array([1.2, 0.85])
QUARTER_TURN_DEGREES = 90.0
TILT_DEGREES = 15.0

SAMPLE_SPACING = 0.01
FLOATING_GAP = 0.04
LOOP_MIN_LENGTH = 4 * FLOATING_GAP
CHORD_MIN_LENGTH = 0.04
CHORD_GROWTH = 3.0
NEAREST_CHUNK = 512

SHEET_ROWS = 16
PAGE_ROWS = 4
CELL = 380
CELL_PADDING = 30
CELL_TEXT_BAND = 22
HEADER_HEIGHT = 44
LEGEND_BASELINE = 16
TITLE_BASELINE = 36
LEGEND = "light grey: the player's ink   black: tidied   red: added   lengths: share of diagonal"
SUBPIXEL_BITS = 4
WHITE: Colour = (255, 255, 255)
BLACK: Colour = (0, 0, 0)
GREY: Colour = (205, 205, 205)
RED: Colour = (0, 0, 225)
RULE: Colour = (225, 225, 225)
TEXT: Colour = (70, 70, 70)
FONT = cv2.FONT_HERSHEY_SIMPLEX
FONT_SCALE = 0.42
PROGRESS_EVERY_DRAWINGS = 10

TABLE_FORMATS = {
    "departure": ".4f",
    "floating_ends": ".2f",
    "chords": ".2f",
    "added_share": ".3f",
    "moved_mean": ".4f",
    "ms": ".1f",
}


@dataclass(frozen=True, slots=True)
class Sample:
    index: int
    category: str
    key_id: int
    strokes: list[Points]


@dataclass(frozen=True, slots=True)
class Measures:
    shape_violations: int
    moved_mean: float
    moved_max: float
    added_count: int
    added_share: float
    floating_ends: int
    floating_open_ends: int
    chords: int
    chords_length: float
    departure: float


@dataclass(frozen=True, slots=True)
class Outcome:
    firmness: float
    ms: float
    completion: Completion | None
    measures: Measures | None


@dataclass(frozen=True, slots=True)
class Trial:
    sample: Sample
    variant: str
    player: list[Points]
    outcomes: list[Outcome]


def segment_lengths(stroke: Points) -> NDArray[np.float64]:
    return np.asarray(np.linalg.norm(np.diff(stroke, axis=0), axis=1), dtype=np.float64)


def ink_length(strokes: Sequence[Points]) -> float:
    return float(sum(segment_lengths(stroke).sum() for stroke in strokes))


def all_points(strokes: Sequence[Points]) -> Points:
    return np.concatenate([np.zeros((0, 2)), *strokes])


def centre_of(strokes: Sequence[Points]) -> Points:
    points = all_points(strokes)
    return np.asarray((points.min(axis=0) + points.max(axis=0)) / 2, dtype=np.float64)


def diagonal_of(strokes: Sequence[Points]) -> float:
    points = all_points(strokes)
    return float(np.linalg.norm(points.max(axis=0) - points.min(axis=0)))


def resampled(stroke: Points, spacing: float) -> Points:
    if len(stroke) < 2:
        return stroke.copy()
    travelled = np.concatenate([[0.0], np.cumsum(segment_lengths(stroke))])
    length = float(travelled[-1])
    if length == 0.0:
        return stroke[:1].copy()
    stations = np.linspace(0.0, length, max(2, int(np.ceil(length / spacing)) + 1))
    return np.column_stack([np.interp(stations, travelled, stroke[:, axis]) for axis in (0, 1)])


def cloud_of(strokes: Sequence[Points], spacing: float) -> Points:
    return all_points([resampled(stroke, spacing) for stroke in strokes if len(stroke) > 0])


def nearest_distances(points: Points, targets: Points) -> NDArray[np.float64]:
    if len(targets) == 0:
        return np.full(len(points), np.inf)
    chunks = [
        np.linalg.norm(points[start : start + NEAREST_CHUNK, None] - targets[None], axis=2).min(
            axis=1
        )
        for start in range(0, len(points), NEAREST_CHUNK)
    ]
    return np.concatenate([np.zeros(0), *chunks])


def to_world(drawing: Drawing) -> list[Points]:
    scale = WORLD_SPAN / QUICKDRAW_SPAN
    return [
        (np.stack([xs, ys], axis=1).astype(np.float64) - QUICKDRAW_SPAN / 2) * scale + WORLD_CENTRE
        for xs, ys in drawing.strokes
        if len(xs) > 0
    ]


def as_pen_ink(strokes: list[Points]) -> list[Points]:
    """The game samples the pen every few pixels; Quick, Draw! keeps only a line's corners."""
    spacing = max(PEN_SPACING, ink_length(strokes) / MAX_PLAYER_POINTS)
    return [resampled(stroke, spacing) for stroke in strokes]


def _wobble(stroke: Points, diagonal: float, rng: np.random.Generator) -> Points:
    travelled = np.concatenate([[0.0], np.cumsum(segment_lengths(stroke))])[:, None, None]
    wavelengths = rng.uniform(*WOBBLE_WAVELENGTHS, size=(1, WOBBLE_WAVES, 2)) * diagonal
    phases = rng.uniform(0.0, 2 * np.pi, size=(1, WOBBLE_WAVES, 2))
    waves = np.sin(2 * np.pi * travelled / wavelengths + phases).sum(axis=1)
    unit_rms_offsets = waves / np.sqrt(WOBBLE_WAVES)
    return np.asarray(stroke + WOBBLE_AMPLITUDE * diagonal * unit_rms_offsets, dtype=np.float64)


def wobbly(strokes: list[Points], rng: np.random.Generator) -> list[Points]:
    centre, diagonal = centre_of(strokes), diagonal_of(strokes)
    shaky = [_wobble(stroke, diagonal, rng) for stroke in strokes]
    return [(stroke - centre) * WOBBLE_STRETCH + centre for stroke in shaky]


def turned(degrees: float) -> Variant:
    """Clockwise on a screen whose y grows downward."""
    angle = np.deg2rad(degrees)
    rotation = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])

    def turn(strokes: list[Points], _rng: np.random.Generator) -> list[Points]:
        centre = centre_of(strokes)
        return [(stroke - centre) @ rotation.T + centre for stroke in strokes]

    return turn


def mirrored(strokes: list[Points], _rng: np.random.Generator) -> list[Points]:
    centre = centre_of(strokes)
    return [(stroke - centre) * np.array([-1.0, 1.0]) + centre for stroke in strokes]


def asis(strokes: list[Points], _rng: np.random.Generator) -> list[Points]:
    return [stroke.copy() for stroke in strokes]


VARIANTS: dict[str, Variant] = {
    "asis": asis,
    "wobbly": wobbly,
    "mirrored": mirrored,
    "quarter": turned(QUARTER_TURN_DEGREES),
    "tilted": turned(TILT_DEGREES),
}


def is_reviewable(drawing: Drawing, exemplar_key_ids: frozenset[int]) -> bool:
    inked = [np.stack([xs, ys], axis=1) for xs, ys in drawing.strokes if len(xs) > 0]
    return (
        drawing.recognized
        and split_of(drawing.key_id) is Split.TEST
        and drawing.key_id not in exemplar_key_ids
        and bool(inked)
        and bool(np.ptp(np.concatenate(inked), axis=0).any())
    )


def pick_drawings(
    bin_dir: Path,
    categories: Sequence[str],
    count: int,
    seed: int,
    exemplar_key_ids: frozenset[int],
) -> list[Sample]:
    """Evenly over the categories and interleaved, so any prefix of the list is a spread too."""
    per_category: list[list[Drawing]] = []
    for position, category in enumerate(categories):
        quota = count // len(categories) + (position < count % len(categories))
        eligible = [
            drawing
            for drawing in read_drawings(category_path(bin_dir, category))
            if is_reviewable(drawing, exemplar_key_ids)
        ]
        rng = np.random.default_rng([seed, position])
        chosen = np.sort(rng.choice(len(eligible), size=min(quota, len(eligible)), replace=False))
        per_category.append([eligible[row] for row in chosen])
    interleaved = [
        (category, drawing)
        for round_of in zip_longest(*per_category)
        for category, drawing in zip(categories, round_of, strict=True)
        if drawing is not None
    ]
    return [
        Sample(index, category, drawing.key_id, as_pen_ink(to_world(drawing)))
        for index, (category, drawing) in enumerate(interleaved)
    ]


def shape_violations(player: Sequence[Points], tidied: Sequence[Points]) -> int:
    mismatched = sum(
        before.shape != after.shape for before, after in zip(player, tidied, strict=False)
    )
    return abs(len(player) - len(tidied)) + mismatched


def same_shaped(player: Sequence[Points], tidied: Sequence[Points]) -> list[tuple[Points, Points]]:
    return [
        (before, after)
        for before, after in zip(player, tidied, strict=False)
        if before.shape == after.shape
    ]


def displacements(pairs: Sequence[tuple[Points, Points]]) -> NDArray[np.float64]:
    moved = [np.linalg.norm(after - before, axis=1) for before, after in pairs]
    return np.concatenate([np.zeros(0), *moved])


def chord_lengths(pairs: Sequence[tuple[Points, Points]], diagonal: float) -> NDArray[np.float64]:
    """Tidied segments stretched long across the drawing where the pen took one short step."""
    found = [np.zeros(0)]
    for before, after in pairs:
        drawn, stretched = segment_lengths(before), segment_lengths(after)
        is_chord = (stretched > CHORD_MIN_LENGTH * diagonal) & (stretched > CHORD_GROWTH * drawn)
        found.append(stretched[is_chord])
    return np.concatenate(found)


def _is_loop(stroke: Points, diagonal: float) -> bool:
    closes = float(np.linalg.norm(stroke[-1] - stroke[0])) <= FLOATING_GAP * diagonal
    return closes and ink_length([stroke]) > LOOP_MIN_LENGTH * diagonal


def floating_ends(
    tidied: Sequence[Points], added: Sequence[Points], diagonal: float
) -> tuple[int, int]:
    """Ends of added strokes that touch nothing else; the second count leaves closed loops out."""
    spacing = SAMPLE_SPACING * diagonal
    ink = cloud_of(tidied, spacing)
    clouds = [resampled(stroke, spacing) for stroke in added]
    floating = open_floating = 0
    for index, stroke in enumerate(added):
        if len(stroke) == 0:
            continue
        others = all_points([ink, *(cloud for at, cloud in enumerate(clouds) if at != index)])
        ends = stroke[[0, -1]] if len(stroke) > 1 else stroke[:1]
        adrift = int((nearest_distances(ends, others) > FLOATING_GAP * diagonal).sum())
        floating += adrift
        open_floating += 0 if _is_loop(stroke, diagonal) else adrift
    return floating, open_floating


def departure(player: Sequence[Points], final: Sequence[Points], diagonal: float) -> float:
    spacing = SAMPLE_SPACING * diagonal
    drawn, shown = cloud_of(player, spacing), cloud_of(final, spacing)
    there = nearest_distances(drawn, shown).mean()
    back = nearest_distances(shown, drawn).mean()
    return float((there + back) / 2 / diagonal)


def measure(player: list[Points], completion: Completion) -> Measures:
    diagonal = diagonal_of(player)
    pairs = same_shaped(player, completion.tidied)
    moved = displacements(pairs) / diagonal
    chords = chord_lengths(pairs, diagonal) / diagonal
    floating, open_floating = floating_ends(completion.tidied, completion.added, diagonal)
    return Measures(
        shape_violations=shape_violations(player, completion.tidied),
        moved_mean=float(moved.mean()) if len(moved) else 0.0,
        moved_max=float(moved.max()) if len(moved) else 0.0,
        added_count=len(completion.added),
        added_share=ink_length(completion.added) / ink_length(player),
        floating_ends=floating,
        floating_open_ends=open_floating,
        chords=len(chords),
        chords_length=float(chords.sum()),
        departure=departure(player, [*completion.tidied, *completion.added], diagonal),
    )


def run_trial(completer: SketchCompleter, sample: Sample, variant: str, seed: int) -> Trial:
    rng = np.random.default_rng([seed, sample.index])
    player = VARIANTS[variant](sample.strokes, rng)
    outcomes: list[Outcome] = []
    for firmness in FIRMNESSES:
        started = time.perf_counter()
        completion = completer.complete(player, name=sample.category, firmness=firmness)
        ms = (time.perf_counter() - started) * 1000
        measures = measure(player, completion) if completion is not None else None
        outcomes.append(Outcome(firmness, ms, completion, measures))
    return Trial(sample, variant, player, outcomes)


def rows_of(trial: Trial) -> list[dict[str, object]]:
    unmeasured: dict[str, object] = dict.fromkeys(field.name for field in fields(Measures))
    return [
        {
            "drawing": trial.sample.index,
            "category": trial.sample.category,
            "key_id": str(trial.sample.key_id),
            "variant": trial.variant,
            "firmness": outcome.firmness,
            "points": sum(len(stroke) for stroke in trial.player),
            "ms": outcome.ms,
            "completed": outcome.completion is not None,
            **(asdict(outcome.measures) if outcome.measures is not None else unmeasured),
            **_provenance(outcome.completion),
        }
        for outcome in trial.outcomes
    ]


def _provenance(completion: Completion | None) -> dict[str, object]:
    if completion is None:
        return dict.fromkeys(("read_as", "confidence", "similarity", "boldness", "exemplar"))
    return {
        "read_as": completion.category,
        "confidence": completion.confidence,
        "similarity": completion.similarity,
        "boldness": completion.boldness,
        "exemplar": str(completion.exemplar_key_id),
    }


def summary_table(rows: Sequence[dict[str, object]]) -> str:
    heads = "".join(f" | {name:>15}" for name in TABLE_FORMATS)
    lines = ["every cell is mean/p90", f"{'variant':<9}{'firm':>5}{'none':>5}{heads}"]
    for variant in VARIANTS:
        for firmness in FIRMNESSES:
            group = [
                row for row in rows if row["variant"] == variant and row["firmness"] == firmness
            ]
            cells = "".join(
                f" | {_mean_and_p90(group, name, number):>15}"
                for name, number in TABLE_FORMATS.items()
            )
            unanswered = sum(not row["completed"] for row in group)
            lines.append(f"{variant:<9}{firmness:>5.2f}{unanswered:>5}{cells}")
    return "\n".join(lines)


def _mean_and_p90(group: Sequence[dict[str, object]], name: str, number: str) -> str:
    values = np.array([row[name] for row in group if row[name] is not None], dtype=np.float64)
    if len(values) == 0:
        return "-"
    return f"{values.mean():{number}}/{np.percentile(values, 90):{number}}"


def _in_cell(strokes: Sequence[Points], centre: Points, scale: float, column: int) -> list[Points]:
    middle = np.array([column * CELL + CELL / 2, CELL_TEXT_BAND + (CELL - CELL_TEXT_BAND) / 2])
    return [(stroke - centre) * scale + middle for stroke in strokes if len(stroke) > 0]


def draw_ink(picture: Picture, strokes: Sequence[Points], colour: Colour, thickness: int) -> None:
    for stroke in strokes:
        pixels = np.rint(stroke * (1 << SUBPIXEL_BITS)).astype(np.int32).reshape(-1, 1, 2)
        if len(pixels) == 1:
            x, y = (int(value) for value in pixels[0, 0])
            radius = thickness << SUBPIXEL_BITS
            cv2.circle(picture, (x, y), radius, colour, cv2.FILLED, cv2.LINE_AA, SUBPIXEL_BITS)
        else:
            cv2.polylines(picture, [pixels], False, colour, thickness, cv2.LINE_AA, SUBPIXEL_BITS)


def blank(height: int) -> Picture:
    return np.full((height, CELL * (1 + len(FIRMNESSES)), 3), WHITE, dtype=np.uint8)


def write_text(picture: Picture, text: str, column: int, baseline: int = 15) -> None:
    cv2.putText(
        picture, text, (column * CELL + 6, baseline), FONT, FONT_SCALE, TEXT, 1, cv2.LINE_AA
    )


def row_picture(trial: Trial) -> Picture:
    """One scale and one centre for the whole row, so the cells can be compared by eye."""
    picture = blank(CELL)
    shown = [
        stroke
        for outcome in trial.outcomes
        if outcome.completion is not None
        for stroke in (*outcome.completion.tidied, *outcome.completion.added)
    ]
    everything = all_points([*trial.player, *shown])
    extent = float(np.ptp(everything, axis=0).max())
    scale = (CELL - CELL_TEXT_BAND - 2 * CELL_PADDING) / max(extent, 1e-9)
    centre = centre_of([everything])

    draw_ink(picture, _in_cell(trial.player, centre, scale, 0), BLACK, 2)
    write_text(picture, f"#{trial.sample.index} {trial.sample.category} {trial.sample.key_id}", 0)
    for column, outcome in enumerate(trial.outcomes, start=1):
        if outcome.completion is None or outcome.measures is None:
            write_text(picture, "none", column)
            continue
        measures = outcome.measures
        draw_ink(picture, _in_cell(trial.player, centre, scale, column), GREY, 3)
        draw_ink(picture, _in_cell(outcome.completion.tidied, centre, scale, column), BLACK, 2)
        draw_ink(picture, _in_cell(outcome.completion.added, centre, scale, column), RED, 2)
        write_text(
            picture,
            f"dep {measures.departure:.3f}  float {measures.floating_ends}"
            f"  chords {measures.chords}  +{measures.added_count}",
            column,
        )
    for column in range(1, 1 + len(FIRMNESSES)):
        cv2.line(picture, (column * CELL, 0), (column * CELL, CELL), RULE, 1)
    cv2.line(picture, (0, CELL - 1), (picture.shape[1], CELL - 1), RULE, 1)
    return picture


def header_picture(variant: str) -> Picture:
    picture = blank(HEADER_HEIGHT)
    titles = [f"player ({variant})", *(f"firmness {firmness:g}" for firmness in FIRMNESSES)]
    write_text(picture, LEGEND, 0, baseline=LEGEND_BASELINE)
    for column, title in enumerate(titles):
        write_text(picture, title, column, baseline=TITLE_BASELINE)
    return picture


def write_sheets(trials: Sequence[Trial], out_dir: Path) -> list[Path]:
    """The whole sheet per variant, and the same rows a few to a page for screens."""
    written: list[Path] = []
    for variant in VARIANTS:
        rows = [
            row_picture(trial)
            for trial in trials
            if trial.variant == variant and trial.sample.index < SHEET_ROWS
        ]
        if not rows:
            continue
        header = header_picture(variant)
        pages = [rows[start : start + PAGE_ROWS] for start in range(0, len(rows), PAGE_ROWS)]
        named = {out_dir / f"sheet-{variant}.png": rows} | {
            out_dir / f"sheet-{variant}-p{number}.png": page
            for number, page in enumerate(pages, start=1)
        }
        for path, pictures in named.items():
            cv2.imwrite(str(path), np.vstack([header, *pictures]))
            written.append(path)
    return written


def known_categories(wanted: Sequence[str], labels: Sequence[str], bin_dir: Path) -> list[str]:
    known = [
        category
        for category in wanted
        if category in labels and category_path(bin_dir, category).exists()
    ]
    dropped = sorted(set(wanted) - set(known))
    if dropped:
        print(f"dropped (no such label or no drawings on disk): {', '.join(dropped)}", flush=True)
    if not known:
        raise SystemExit("none of the categories can be reviewed with this bundle and data")
    return known


def review(
    completer: SketchCompleter, samples: Sequence[Sample], seed: int, started: float
) -> list[Trial]:
    completer.complete(samples[0].strokes, name=samples[0].category)
    trials: list[Trial] = []
    for sample in samples:
        trials += [run_trial(completer, sample, variant, seed) for variant in VARIANTS]
        if (sample.index + 1) % PROGRESS_EVERY_DRAWINGS == 0:
            elapsed = time.perf_counter() - started
            print(f"  {sample.index + 1}/{len(samples)} drawings, {elapsed:.0f} s", flush=True)
    return trials


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="an artifacts/<name> directory")
    parser.add_argument("--data", type=Path, required=True, help="holds bin/<category>.bin")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--drawings", type=int, default=DEFAULT_DRAWINGS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--categories", type=str, default=",".join(DEFAULT_CATEGORIES))
    parser.add_argument("--threads", type=int, default=DEFAULT_THREADS, help="ONNX Runtime threads")
    parsed = parser.parse_args()

    started = time.perf_counter()
    cv2.setNumThreads(parsed.threads)
    model_dir = parsed.model.resolve(strict=True)
    bin_dir = parsed.data / "bin" if (parsed.data / "bin").is_dir() else parsed.data
    recognizer = SketchRecognizer(model_dir, threads=parsed.threads)
    exemplars = load_exemplars_of_model(model_dir)
    if exemplars is None:
        raise SystemExit(f"{model_dir} has no exemplar set: there is no morph to review")
    completer = SketchCompleter(recognizer, exemplars)

    wanted = [name.strip() for name in parsed.categories.split(",") if name.strip()]
    categories = known_categories(wanted, recognizer.labels, bin_dir)
    exemplar_key_ids = frozenset(int(key_id) for key_id in exemplars.key_ids)
    samples = pick_drawings(bin_dir, categories, parsed.drawings, parsed.seed, exemplar_key_ids)
    if not samples:
        raise SystemExit(f"no test drawings of {', '.join(categories)} under {bin_dir}")
    picked_s = time.perf_counter() - started
    print(
        f"{len(samples)} test drawings of {len(categories)} categories in {picked_s:.0f} s",
        flush=True,
    )

    trials = review(completer, samples, parsed.seed, started)
    rows = [row for trial in trials for row in rows_of(trial)]
    parsed.out.mkdir(parents=True, exist_ok=True)
    (parsed.out / "metrics.json").write_text(json.dumps(rows, indent=1))
    sheets = write_sheets(trials, parsed.out)

    print(summary_table(rows))
    violations = sum(
        outcome.measures.shape_violations
        for trial in trials
        for outcome in trial.outcomes
        if outcome.measures is not None
    )
    total_s = time.perf_counter() - started
    print(f"{len(rows)} calls, {violations} shape violations, {len(sheets)} PNGs, {total_s:.0f} s")
    print(f"written to {parsed.out}")


if __name__ == "__main__":
    main()
