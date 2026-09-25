import numpy as np
import pytest

from handwriting.ink import (
    INK,
    INK_HEIGHT,
    MARGIN,
    MAX_LINES,
    MAX_WIDTH,
    PAPER,
    Strokes,
    render_line,
    split_lines,
)

WORD: Strokes = [
    [(0.0, 0.0), (0.0, 40.0)],
    [(0.0, 20.0), (20.0, 20.0)],
    [(20.0, 0.0), (20.0, 40.0)],
    [(40.0, 10.0), (40.0, 40.0)],
]
I_DOT: Strokes = [[(40.0, 0.0)]]


def shifted(strokes: Strokes, dy: float, dx: float = 0.0) -> Strokes:
    return [[(x + dx, y + dy) for x, y in stroke] for stroke in strokes]


def test_a_line_is_drawn_ink_height_tall_with_a_margin_black_on_white() -> None:
    image = render_line(WORD)
    assert image.dtype == np.uint8
    assert image.shape == (INK_HEIGHT + 2 * MARGIN + 1, INK_HEIGHT + 2 * MARGIN + 1)
    assert image.min() == INK
    assert image.max() == PAPER
    assert (image[: MARGIN - 2] == PAPER).all()


def test_where_and_how_big_the_ink_was_does_not_matter() -> None:
    moved = [[(x * 4 + 1000, y * 4 - 500) for x, y in stroke] for stroke in WORD]
    assert np.array_equal(render_line(WORD), render_line(moved))


def test_a_lone_point_is_a_dot_and_empty_strokes_are_ignored() -> None:
    image = render_line([[], [(5.0, 5.0)]])
    assert image.shape == (2 * MARGIN + 1, 2 * MARGIN + 1)
    assert image[MARGIN, MARGIN] < PAPER // 2


def test_there_is_nothing_to_draw_without_a_point() -> None:
    with pytest.raises(ValueError, match="at least one point"):
        render_line([[]])


def test_a_very_long_line_is_narrowed_to_the_widest_image() -> None:
    image = render_line([[(0.0, 0.0), (100_000.0, 10.0)]])
    assert image.shape[1] <= MAX_WIDTH
    assert image.shape[0] < INK_HEIGHT


def test_a_flat_stroke_is_as_wide_as_the_widest_image() -> None:
    assert render_line([[(0.0, 5.0), (300.0, 5.0)]]).shape[1] == MAX_WIDTH


def test_two_lines_apart_are_read_top_first() -> None:
    second = shifted(WORD, 100.0)
    lines = split_lines([*second, *WORD])
    assert lines == [list(WORD), list(second)]


def test_the_dot_of_an_i_stays_with_its_line() -> None:
    word = [*shifted(WORD, 15.0), *I_DOT]
    assert split_lines(word) == [word]


def test_lines_that_touch_are_one_line() -> None:
    touching = shifted(WORD, 35.0)
    assert len(split_lines([*WORD, *touching])) == 1


def test_more_lines_than_a_note_has_are_read_as_one() -> None:
    many = [stroke for row in range(MAX_LINES + 1) for stroke in shifted(WORD, row * 100.0)]
    assert split_lines(many) == [many]
