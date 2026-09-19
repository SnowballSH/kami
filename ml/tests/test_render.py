import numpy as np
import pytest

from render import (
    CANVAS,
    MARGIN,
    SIZE,
    Point,
    from_xy_arrays,
    render,
    render_prefix,
    take_prefix,
    to_model_input,
)

HOUSE: list[list[Point]] = [
    [(10, 60), (10, 20), (50, 20), (50, 60), (10, 60)],
    [(10, 20), (30, 0), (50, 20)],
    [(25, 60), (25, 40), (35, 40), (35, 60)],
]
DOWNSAMPLE = CANVAS // SIZE


def transformed(
    strokes: list[list[Point]], scale: float, dx: float, dy: float
) -> list[list[Point]]:
    return [[(x * scale + dx, y * scale + dy) for x, y in stroke] for stroke in strokes]


def test_render_is_deterministic_and_well_formed() -> None:
    first, second = render(HOUSE), render(HOUSE)
    assert first.shape == (SIZE, SIZE)
    assert first.dtype == np.uint8
    assert np.array_equal(first, second)
    assert first.max() > 200
    assert 0.02 < (first > 0).mean() < 0.5


def test_ink_stays_inside_the_margin_and_is_centred() -> None:
    image = render(HOUSE)
    rows, columns = np.nonzero(image)
    clear = (MARGIN - 4) // DOWNSAMPLE
    assert rows.min() >= clear and columns.min() >= clear
    assert rows.max() < SIZE - clear and columns.max() < SIZE - clear
    assert abs((columns.min() + columns.max()) / 2 - (SIZE - 1) / 2) <= 1


@pytest.mark.parametrize(("scale", "dx", "dy"), [(1, 300, -120), (2, 0, 0), (0.5, -40, 1000)])
def test_translation_and_power_of_two_scale_change_nothing(
    scale: float, dx: float, dy: float
) -> None:
    assert np.array_equal(render(HOUSE), render(transformed(HOUSE, scale, dx, dy)))


def test_arbitrary_scale_changes_almost_nothing() -> None:
    difference = np.abs(
        render(HOUSE).astype(np.int16)
        - render(transformed(HOUSE, 3.7, 12.3, -7.9)).astype(np.int16)
    )
    assert difference.mean() < 1.0


def test_empty_input_is_a_blank_image() -> None:
    assert not render([]).any()
    assert not render([[], []]).any()


def test_single_point_is_a_dot_in_the_centre() -> None:
    image = render([[(123.0, -45.0)]])
    rows, columns = np.nonzero(image)
    centre = SIZE // 2
    assert image.any()
    assert abs(rows.mean() - centre) <= 1 and abs(columns.mean() - centre) <= 1
    assert np.ptp(rows) <= 3 and np.ptp(columns) <= 3


def test_single_point_stroke_is_drawn_beside_a_line() -> None:
    with_dot = render([[(0, 0), (100, 0)], [(50, 60)]])
    assert with_dot[SIZE // 2 :, :].any()


def test_non_finite_coordinates_are_rejected() -> None:
    with pytest.raises(ValueError, match="finite"):
        render([[(0.0, float("nan")), (1.0, 1.0)]])


def test_prefix_keeps_points_in_drawing_order() -> None:
    prefix = take_prefix(HOUSE, 0.5)
    assert sum(len(stroke) for stroke in prefix) == 6
    assert np.array_equal(prefix[0], np.asarray(HOUSE[0], dtype=np.float64))
    assert np.array_equal(prefix[1], np.asarray(HOUSE[1][:1], dtype=np.float64))
    assert len(take_prefix(HOUSE, 0.01)) == 1


def test_prefix_is_refitted_to_its_own_bounds() -> None:
    walls_only = render_prefix(HOUSE, 5 / 12)
    assert np.array_equal(walls_only, render(HOUSE[:1]))
    assert not np.array_equal(walls_only, render(HOUSE))
    columns = np.nonzero(walls_only)[1]
    assert columns.max() - columns.min() > SIZE * 0.75


def test_full_prefix_is_the_whole_drawing() -> None:
    assert np.array_equal(render_prefix(HOUSE, 1.0), render(HOUSE))


def test_quickdraw_xy_form_matches_point_form() -> None:
    xy_strokes = [([x for x, _ in stroke], [y for _, y in stroke]) for stroke in HOUSE]
    assert np.array_equal(render(from_xy_arrays(xy_strokes)), render(HOUSE))


def test_model_input_is_unit_range_nchw() -> None:
    batch = to_model_input(render(HOUSE))
    assert batch.shape == (1, 1, SIZE, SIZE)
    assert batch.dtype == np.float32
    assert batch.min() >= 0.0 and batch.max() <= 1.0
