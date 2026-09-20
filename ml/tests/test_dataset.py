from collections import Counter
from pathlib import Path

import numpy as np

from dataset import (
    FULL_FRACTION,
    DatasetSpec,
    Split,
    build_dataset,
    ensure_dataset,
    load_dataset,
    split_of,
)
from quickdraw_bin import Drawing, category_path, read_drawings, write_drawings
from render import SIZE, THICKNESS, from_xy_arrays, render, render_prefix
from views import FINISHED_VIEW, PREFIX_VIEW_BOUNDS, STRATIFIED_VIEW_COUNT

CATEGORIES = ("zig", "zag")
DRAWINGS_PER_CATEGORY = 60
SAMPLES_PER_CLASS = 40


def synthetic_drawing(key_id: int, rng: np.random.Generator, recognized: bool) -> Drawing:
    strokes = [
        (rng.integers(0, 256, 6).astype(np.uint8), rng.integers(0, 256, 6).astype(np.uint8))
        for _ in range(3)
    ]
    return Drawing(key_id, "US", recognized, 0, strokes)


def write_synthetic_bins(bin_dir: Path) -> None:
    bin_dir.mkdir()
    rng = np.random.default_rng(1)
    for offset, category in enumerate(CATEGORIES):
        drawings = [
            synthetic_drawing(offset * 1000 + index, rng, recognized=index % 10 != 0)
            for index in range(DRAWINGS_PER_CATEGORY)
        ]
        write_drawings(category_path(bin_dir, category), drawings)


def test_split_is_deterministic_and_roughly_90_5_5() -> None:
    splits = Counter(split_of(key_id) for key_id in range(5_000_000_000, 5_000_020_000))
    assert split_of(123_456_789) == split_of(123_456_789)
    assert 0.88 < splits[Split.TRAIN] / 20_000 < 0.92
    assert 0.04 < splits[Split.VAL] / 20_000 < 0.06
    assert 0.04 < splits[Split.TEST] / 20_000 < 0.06


def test_build_renders_recognised_drawings_with_prefixes(tmp_path: Path) -> None:
    write_synthetic_bins(tmp_path / "bin")
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS)
    dataset = build_dataset(spec, tmp_path / "bin", tmp_path / "out")

    assert dataset.images.shape == (2 * SAMPLES_PER_CLASS, 1, SIZE, SIZE)
    assert dataset.fractions.shape == (2 * SAMPLES_PER_CLASS, 1)
    assert np.array_equal(dataset.labels, np.repeat([0, 1], SAMPLES_PER_CLASS))
    assert all(key_id % 1000 % 10 != 0 for key_id in dataset.key_ids.tolist())
    assert [split_of(key_id) for key_id in dataset.key_ids.tolist()] == dataset.splits.tolist()

    prefixes = dataset.fractions < FULL_FRACTION
    assert 0.25 < prefixes.mean() < 0.75
    assert dataset.fractions[prefixes].min() >= spec.min_prefix_fraction
    assert sum(len(dataset.indices(split)) for split in Split) == len(dataset.labels)

    rebuilt = build_dataset(spec, tmp_path / "bin", tmp_path / "again")
    assert np.array_equal(np.asarray(dataset.images), np.asarray(rebuilt.images))


def test_finished_samples_match_the_contract_render(tmp_path: Path) -> None:
    write_synthetic_bins(tmp_path / "bin")
    dataset = build_dataset(
        DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS), tmp_path / "bin", tmp_path / "out"
    )
    by_key = {
        drawing.key_id: drawing
        for category in CATEGORIES
        for drawing in read_drawings(category_path(tmp_path / "bin", category))
    }
    finished = np.flatnonzero(dataset.fractions[:, FINISHED_VIEW] >= FULL_FRACTION)[:5]
    for index in finished:
        strokes = from_xy_arrays(by_key[int(dataset.key_ids[index])].strokes)
        assert np.array_equal(
            dataset.images[index, FINISHED_VIEW], render(strokes, thickness=THICKNESS)
        )


def test_ensure_reuses_a_matching_build_and_rebuilds_on_change(tmp_path: Path) -> None:
    write_synthetic_bins(tmp_path / "bin")
    out_dir = tmp_path / "out"
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS)
    ensure_dataset(spec, tmp_path / "bin", out_dir)
    built_at = (out_dir / "images.u8").stat().st_mtime_ns
    ensure_dataset(spec, tmp_path / "bin", out_dir)
    assert (out_dir / "images.u8").stat().st_mtime_ns == built_at

    smaller = ensure_dataset(DatasetSpec(CATEGORIES, 10), tmp_path / "bin", out_dir)
    assert len(smaller.labels) == 20


def test_a_single_view_build_keeps_the_files_and_fingerprint_of_the_first_recipe(
    tmp_path: Path,
) -> None:
    write_synthetic_bins(tmp_path / "bin")
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS)
    build_dataset(spec, tmp_path / "bin", tmp_path / "out")

    assert "views" not in spec.fingerprint()
    assert np.load(tmp_path / "out" / "fractions.npy").shape == (2 * SAMPLES_PER_CLASS,)
    assert (tmp_path / "out" / "images.u8").stat().st_size == 2 * SAMPLES_PER_CLASS * SIZE * SIZE


def test_four_views_are_the_finished_render_and_one_prefix_per_band(tmp_path: Path) -> None:
    write_synthetic_bins(tmp_path / "bin")
    spec = DatasetSpec(CATEGORIES, SAMPLES_PER_CLASS, views=STRATIFIED_VIEW_COUNT)
    dataset = build_dataset(spec, tmp_path / "bin", tmp_path / "out", workers=2)

    assert dataset.view_count == STRATIFIED_VIEW_COUNT
    assert dataset.images.shape == (2 * SAMPLES_PER_CLASS, STRATIFIED_VIEW_COUNT, SIZE, SIZE)
    assert np.all(dataset.fractions[:, FINISHED_VIEW] == FULL_FRACTION)
    for view, (low, high) in enumerate(PREFIX_VIEW_BOUNDS, start=1):
        assert np.all((dataset.fractions[:, view] >= low) & (dataset.fractions[:, view] < high))

    by_key = {
        drawing.key_id: drawing
        for category in CATEGORIES
        for drawing in read_drawings(category_path(tmp_path / "bin", category))
    }
    for index in (0, 17, 2 * SAMPLES_PER_CLASS - 1):
        strokes = from_xy_arrays(by_key[int(dataset.key_ids[index])].strokes)
        assert np.array_equal(dataset.images[index, FINISHED_VIEW], render(strokes))
        for view in range(1, STRATIFIED_VIEW_COUNT):
            fraction = float(dataset.fractions[index, view])
            assert np.array_equal(dataset.images[index, view], render_prefix(strokes, fraction))

    reloaded = load_dataset(tmp_path / "out")
    assert np.array_equal(np.asarray(reloaded.images), np.asarray(dataset.images))


def test_a_build_of_other_views_is_never_reused(tmp_path: Path) -> None:
    write_synthetic_bins(tmp_path / "bin")
    out_dir = tmp_path / "out"
    ensure_dataset(
        DatasetSpec(CATEGORIES, 10, views=STRATIFIED_VIEW_COUNT), tmp_path / "bin", out_dir
    )
    assert ensure_dataset(DatasetSpec(CATEGORIES, 10), tmp_path / "bin", out_dir).view_count == 1
    stratified = DatasetSpec(CATEGORIES, 10, views=STRATIFIED_VIEW_COUNT)
    assert ensure_dataset(stratified, tmp_path / "bin", out_dir).view_count == STRATIFIED_VIEW_COUNT
