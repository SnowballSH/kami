from pathlib import Path

import numpy as np

from quickdraw_bin import (
    Drawing,
    category_url,
    complete_length,
    encode_drawing,
    parse_drawings,
    read_drawings,
    write_drawings,
)


def stroke(xs: list[int], ys: list[int]) -> tuple[np.ndarray, np.ndarray]:
    return np.asarray(xs, dtype=np.uint8), np.asarray(ys, dtype=np.uint8)


DRAWINGS = [
    Drawing(
        5_629_780_803_321_856, "US", True, 1_490_000_000, [stroke([0, 255, 128], [0, 10, 255])]
    ),
    Drawing(2**63 + 7, "DE", False, 1_485_000_000, [stroke([1, 2], [3, 4]), stroke([9], [8])]),
    Drawing(42, "JP", True, 0, []),
]


def assert_same(actual: Drawing, expected: Drawing) -> None:
    assert (actual.key_id, actual.countrycode, actual.recognized, actual.timestamp) == (
        expected.key_id,
        expected.countrycode,
        expected.recognized,
        expected.timestamp,
    )
    assert len(actual.strokes) == len(expected.strokes)
    for (xs, ys), (expected_xs, expected_ys) in zip(actual.strokes, expected.strokes, strict=True):
        assert np.array_equal(xs, expected_xs) and np.array_equal(ys, expected_ys)


def test_round_trip_through_a_file(tmp_path: Path) -> None:
    path = tmp_path / "synthetic.bin"
    write_drawings(path, DRAWINGS)
    parsed = list(read_drawings(path))
    assert len(parsed) == len(DRAWINGS)
    for actual, expected in zip(parsed, DRAWINGS, strict=True):
        assert_same(actual, expected)


def test_record_layout_matches_the_published_format() -> None:
    encoded = encode_drawing(DRAWINGS[0])
    assert len(encoded) == 8 + 2 + 1 + 4 + 2 + (2 + 3 + 3)
    assert encoded[8:10] == b"US"
    assert encoded[-6:] == bytes([0, 255, 128, 0, 10, 255])


def test_a_trailing_partial_record_is_dropped() -> None:
    records = [encode_drawing(drawing) for drawing in DRAWINGS]
    two_whole = records[0] + records[1]
    for partial_bytes in (1, 5, len(records[2]) - 1):
        truncated = two_whole + records[2][:partial_bytes]
        assert len(list(parse_drawings(truncated))) == 2
        assert complete_length(truncated) == len(two_whole)
    cut_inside_a_stroke = records[0] + records[1][:-1]
    assert complete_length(cut_inside_a_stroke) == len(records[0])
    assert complete_length(b"".join(records)) == len(b"".join(records))


def test_category_names_are_url_quoted() -> None:
    assert category_url("hot air balloon").endswith("/hot%20air%20balloon.bin")
