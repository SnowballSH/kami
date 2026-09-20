"""Pure boundary checks: no model instances, rendering or inference."""

import re
import unittest
from pathlib import Path
from unittest.mock import patch

from sidecar import (
    MAX_BODY_BYTES,
    MAX_COORDINATE,
    MAX_NAME_LENGTH,
    MAX_POINTS,
    MAX_POINTS_PER_STROKE,
    MAX_STROKES,
    BadRequest,
    parse_body_length,
    parse_name,
    parse_strokes,
)

GAME_LIMITS = Path(__file__).parents[2] / "src" / "core" / "inputLimits.ts"


class InputLimitTests(unittest.TestCase):
    @unittest.skipUnless(GAME_LIMITS.exists(), "src/core is not beside this copy of ml/")
    def test_contract_matches_the_game(self) -> None:
        source = GAME_LIMITS.read_text()
        limits = {
            "strokes": MAX_STROKES,
            "pointsPerStroke": MAX_POINTS_PER_STROKE,
            "points": MAX_POINTS,
            "coordinate": MAX_COORDINATE,
            "name": MAX_NAME_LENGTH,
            "sketchBytes": MAX_BODY_BYTES,
        }
        for key, expected in limits.items():
            with self.subTest(key=key):
                match = re.search(rf"\b{key}: ([\d_]+)", source)
                if match is None:
                    self.fail(f"missing contract value {key}")
                self.assertEqual(int(match[1].replace("_", "")), expected)

    def test_exact_limits(self) -> None:
        point = {"x": MAX_COORDINATE, "y": -MAX_COORDINATE}
        stroke = [point] * MAX_POINTS_PER_STROKE
        parsed = parse_strokes({"strokes": [stroke, stroke]})
        self.assertEqual(sum(map(len, parsed)), MAX_POINTS)
        self.assertEqual(len(parse_strokes({"strokes": [[point]] * MAX_STROKES})), MAX_STROKES)
        self.assertEqual(parse_body_length(str(MAX_BODY_BYTES)), MAX_BODY_BYTES)
        self.assertEqual(parse_name({"name": "x" * MAX_NAME_LENGTH}), "x" * MAX_NAME_LENGTH)

    def test_counts_are_checked_before_points(self) -> None:
        invalid_point = {"x": "invalid", "y": 0}
        stroke: list[object] = [invalid_point] * MAX_POINTS_PER_STROKE
        cases: list[list[list[object]]] = [
            [stroke, stroke, [invalid_point]],
            [[*stroke, invalid_point]],
            [[]] * (MAX_STROKES + 1),
        ]
        for strokes in cases:
            with self.subTest(strokes=len(strokes)), patch("sidecar._parse_point") as convert:
                with self.assertRaises(BadRequest):
                    parse_strokes({"strokes": strokes})
                convert.assert_not_called()

    def test_coordinates_and_names(self) -> None:
        for x in (
            MAX_COORDINATE + 1,
            -MAX_COORDINATE - 1,
            float("inf"),
            float("nan"),
            10**1000,
            True,
        ):
            with self.subTest(x=x), self.assertRaises(BadRequest):
                parse_strokes({"strokes": [[{"x": x, "y": 0}]]})
        for name in ("x" * (MAX_NAME_LENGTH + 1), "😀" * (MAX_NAME_LENGTH // 2 + 1)):
            with self.subTest(name=name), self.assertRaises(BadRequest):
                parse_name({"name": name})

    def test_body_lengths(self) -> None:
        for length in (None, "", "nan", "0", "-1", str(MAX_BODY_BYTES + 1)):
            with self.subTest(length=length), self.assertRaises(BadRequest):
                parse_body_length(length)


if __name__ == "__main__":
    unittest.main()
