import shutil
from pathlib import Path

import numpy as np
import pytest
from synthetic import EMPTY_CATEGORY, PER_CLASS, random_drawing, xy_stroke
from tiny_model import TINY_LABELS

from exemplar_set import EXEMPLARS_DIR, load_exemplars, load_exemplars_of_model
from exemplars import (
    BuildReport,
    Candidates,
    Selection,
    build_exemplars,
    is_placeable,
    print_summary,
    select,
    write_exemplars,
)
from quickdraw_bin import Drawing, category_path, write_drawings
from recognizer import SketchRecognizer
from render import from_xy_arrays, render


def candidates(
    probabilities: list[float],
    stroke_counts: list[int] | None = None,
    point_counts: list[int] | None = None,
    named_correctly: list[bool] | None = None,
    key_ids: list[int] | None = None,
) -> Candidates:
    count = len(probabilities)
    return Candidates(
        named_correctly=np.asarray(named_correctly or [True] * count, dtype=np.bool_),
        probabilities=np.asarray(probabilities, dtype=np.float64),
        stroke_counts=np.asarray(stroke_counts or [4] * count, dtype=np.int64),
        point_counts=np.asarray(point_counts or [40] * count, dtype=np.int64),
        key_ids=np.asarray(key_ids or list(range(count)), dtype=np.uint64),
    )


def test_only_drawings_the_model_is_sure_of_are_kept_surest_first() -> None:
    chosen = select(candidates([0.95, 0.89, 0.999, 0.9, 0.5]), Selection(per_class=10))
    assert chosen.tolist() == [2, 0, 3]


def test_a_sure_answer_for_another_category_does_not_count() -> None:
    chosen = select(
        candidates([0.99, 0.98, 0.97], named_correctly=[True, False, True]), Selection()
    )
    assert chosen.tolist() == [0, 2]


def test_no_more_than_per_class_are_kept() -> None:
    chosen = select(candidates([0.91, 0.99, 0.95, 0.97]), Selection(per_class=2))
    assert chosen.tolist() == [1, 3]


def test_scribbles_and_shading_are_left_out_however_sure_the_model_is() -> None:
    chosen = select(
        candidates(
            [0.999, 0.999, 0.93, 0.92, 0.91, 0.999, 0.999],
            stroke_counts=[1, 40, 4, 2, 8, 4, 4],
            point_counts=[40, 40, 40, 30, 80, 300, 9],
        ),
        Selection(),
    )
    assert chosen.tolist() == [2, 3, 4]


def test_one_stroke_is_typical_where_the_category_is_drawn_in_one_stroke() -> None:
    chosen = select(candidates([0.95, 0.96, 0.97, 0.98], stroke_counts=[1, 1, 1, 3]), Selection())
    assert chosen.tolist() == [2, 1, 0]


def test_equal_probabilities_prefer_the_more_typical_then_the_lower_key_id() -> None:
    chosen = select(
        candidates(
            [0.95, 0.95, 0.95, 0.95],
            stroke_counts=[4, 6, 4, 4],
            key_ids=[30, 5, 20, 10],
        ),
        Selection(),
    )
    assert chosen.tolist() == [3, 2, 0, 1]


def test_what_cannot_be_placed_is_never_a_candidate() -> None:
    rng = np.random.default_rng(2)
    dot = Drawing(1, "US", True, 0, [xy_stroke([(7, 7)]), xy_stroke([(7, 7), (7, 7)])])
    flat = Drawing(2, "US", True, 0, [xy_stroke([(0, 9), (255, 9)])])
    assert is_placeable(random_drawing(rng, 3))
    assert is_placeable(flat)
    assert not is_placeable(dot)
    assert not is_placeable(Drawing(4, "US", True, 0, []))
    assert not is_placeable(random_drawing(rng, 5, recognized=False))


def test_build_keeps_the_surest_drawings_of_every_category(
    tiny_artifacts: Path, bin_dir: Path, sure_drawings: dict[str, list[Drawing]]
) -> None:
    recognizer = SketchRecognizer(tiny_artifacts)
    exemplar_set, report = build_exemplars(recognizer, bin_dir, Selection(per_class=PER_CLASS))

    assert exemplar_set.categories == tuple(TINY_LABELS)
    assert report.kept == {
        label: 0 if label == EMPTY_CATEGORY else PER_CLASS for label in TINY_LABELS
    }
    assert report.short_of(PER_CLASS) == {EMPTY_CATEGORY: 0}
    assert report.candidates == sum(
        len(drawings) for label, drawings in sure_drawings.items() if label != EMPTY_CATEGORY
    )
    for label, category in enumerate(TINY_LABELS):
        rows = exemplar_set.of_label(label)
        by_key = {drawing.key_id: drawing for drawing in sure_drawings[category]}
        probabilities = exemplar_set.probabilities[rows.start : rows.stop].astype(np.float64)
        assert np.all(probabilities >= 0.9 - 1e-3)
        assert np.all(np.diff(probabilities) <= 0)
        for row in rows:
            source = by_key[int(exemplar_set.key_ids[row])]
            reading = recognizer.read_images(render(from_xy_arrays(source.strokes)))
            assert int(reading.probabilities[0].argmax()) == label
            assert exemplar_set.embeddings[row] == pytest.approx(reading.embeddings[0], abs=1e-3)
            assert np.linalg.norm(exemplar_set.embeddings[row].astype(np.float32)) == (
                pytest.approx(1.0, abs=1e-2)
            )
            for kept, (xs, ys) in zip(exemplar_set.strokes(row), source.strokes, strict=True):
                assert np.array_equal(kept, np.stack([xs, ys], axis=1))


def test_drawings_filed_under_the_wrong_category_are_not_exemplars(
    tiny_artifacts: Path, tmp_path: Path, sure_drawings: dict[str, list[Drawing]]
) -> None:
    write_drawings(category_path(tmp_path, "star"), sure_drawings["mushroom"])
    exemplar_set, report = build_exemplars(SketchRecognizer(tiny_artifacts), tmp_path, Selection())
    assert exemplar_set.count == 0
    assert report.kept["star"] == 0


def test_candidates_are_the_head_of_the_file(
    tiny_artifacts: Path, tmp_path: Path, sure_drawings: dict[str, list[Drawing]]
) -> None:
    head = sure_drawings["mushroom"][:3]
    write_drawings(category_path(tmp_path, "mushroom"), sure_drawings["mushroom"])
    exemplar_set, report = build_exemplars(
        SketchRecognizer(tiny_artifacts), tmp_path, Selection(candidates_per_class=3)
    )
    assert report.candidates == 3
    assert set(exemplar_set.key_ids.tolist()) == {drawing.key_id for drawing in head}


def test_the_same_inputs_write_the_same_files(
    completing_artifacts: Path, bin_dir: Path, tmp_path: Path
) -> None:
    again = tmp_path / "the-same-model-elsewhere"
    shutil.copytree(completing_artifacts, again, ignore=shutil.ignore_patterns(EXEMPLARS_DIR))
    write_exemplars(again, bin_dir, Selection(per_class=PER_CLASS), threads=2)
    for written in sorted((completing_artifacts / EXEMPLARS_DIR).iterdir()):
        assert written.read_bytes() == (again / EXEMPLARS_DIR / written.name).read_bytes()


def test_written_exemplars_load_for_their_model(completing_artifacts: Path) -> None:
    loaded = load_exemplars_of_model(completing_artifacts)
    assert loaded is not None
    assert loaded.count == PER_CLASS * (len(TINY_LABELS) - 1)
    assert loaded.count == load_exemplars(completing_artifacts / EXEMPLARS_DIR).count


def test_the_summary_names_the_categories_that_came_up_short(
    completing_artifacts: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    kept = {label: 0 if label == EMPTY_CATEGORY else PER_CLASS for label in TINY_LABELS}
    print_summary(completing_artifacts, Selection(per_class=PER_CLASS), BuildReport(kept, 99, 2.0))
    printed = capsys.readouterr().out
    assert f"{PER_CLASS * (len(TINY_LABELS) - 1)} exemplars for 6/7 full categories" in printed
    assert f"1 categories short of {PER_CLASS}: {EMPTY_CATEGORY} 0" in printed
