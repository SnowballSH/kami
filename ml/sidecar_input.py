"""What the sidecar accepts: the input limits of ml/CONTRACT.md, checked before any model runs."""

from __future__ import annotations

import math

from morph import DEFAULT_FIRMNESS
from recognizer import DEFAULT_TOP
from render import Point

MAX_BODY_BYTES = 262_144
MAX_STROKES = 256
MAX_POINTS_PER_STROKE = 1024
MAX_POINTS = 2048
MAX_TOP = 1000
MAX_NAME_LENGTH = 80
MAX_COORDINATE = 1e9


class BadRequest(ValueError):
    pass


def parse_strokes(payload: object) -> list[list[Point]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("strokes"), list):
        raise BadRequest("body must be an object with a 'strokes' array")
    raw_strokes = payload["strokes"]
    if len(raw_strokes) > MAX_STROKES:
        raise BadRequest(f"the drawing has more than {MAX_STROKES} strokes")
    total = 0
    for stroke in raw_strokes:
        if not isinstance(stroke, list):
            raise BadRequest("every stroke must be an array of {x, y} points")
        if len(stroke) > MAX_POINTS_PER_STROKE:
            raise BadRequest(f"a stroke has more than {MAX_POINTS_PER_STROKE} points")
        total += len(stroke)
        if total > MAX_POINTS:
            raise BadRequest(f"the drawing has more than {MAX_POINTS} points")
    if total == 0:
        raise BadRequest("the drawing has no points")
    return [[_parse_point(point) for point in stroke] for stroke in raw_strokes]


def _parse_point(point: object) -> Point:
    if not isinstance(point, dict):
        raise BadRequest("every point must be an object {x, y}")
    return _parse_coordinate(point.get("x")), _parse_coordinate(point.get("y"))


def _parse_coordinate(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise BadRequest("point coordinates must be finite numbers")
    if abs(value) > MAX_COORDINATE:
        raise BadRequest(f"point coordinates must be within +-{MAX_COORDINATE:g}")
    if not math.isfinite(value):
        raise BadRequest("point coordinates must be finite numbers")
    return float(value)


def parse_top(payload: dict[str, object]) -> int:
    top = payload.get("top", DEFAULT_TOP)
    if not isinstance(top, int) or isinstance(top, bool) or not 1 <= top <= MAX_TOP:
        raise BadRequest(f"'top' must be an integer from 1 to {MAX_TOP}")
    return top


def parse_partial(payload: dict[str, object]) -> bool:
    partial = payload.get("partial", False)
    if not isinstance(partial, bool):
        raise BadRequest("'partial' must be a boolean")
    return partial


def parse_name(payload: dict[str, object]) -> str | None:
    name = payload.get("name")
    if name is None:
        return None
    if (
        not isinstance(name, str)
        or len(name.encode("utf-16-le", errors="surrogatepass")) // 2 > MAX_NAME_LENGTH
    ):
        raise BadRequest(f"'name' must be a string of at most {MAX_NAME_LENGTH} characters")
    return name


def parse_strength(payload: dict[str, object]) -> float:
    strength = payload.get("strength", DEFAULT_FIRMNESS)
    if isinstance(strength, bool) or not isinstance(strength, int | float):
        raise BadRequest("'strength' must be a number from 0 to 1")
    if not math.isfinite(strength) or not 0.0 <= strength <= 1.0:
        raise BadRequest("'strength' must be a number from 0 to 1")
    return float(strength)


def parse_body_length(value: str | None) -> int:
    try:
        length = int(value or "")
    except ValueError as error:
        raise BadRequest("Content-Length is required") from error
    if not 0 < length <= MAX_BODY_BYTES:
        raise BadRequest(f"body must be 1 to {MAX_BODY_BYTES} bytes")
    return length
