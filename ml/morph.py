"""Morph a sketch toward a clean exemplar: the player's strokes, tidied, plus what is missing.

The player's drawing stays theirs. Every stroke and every point of it survives, each nudged a
bounded distance toward the nearest part of the exemplar; only the parts of the exemplar that
nothing of theirs covers are added. The rules are in CONTRACT.md, "Completion".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

Points = NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class MorphSettings:
    """Distances are shares of the player's bounding-box diagonal, so the morph is scale-free."""

    strength: float = 0.5
    reach: float = 0.12
    max_shift: float = 0.06
    smoothing_window: int = 9
    cover_radius: float = 0.08
    min_added_length: float = 0.10
    bridge_points: int = 2
    sample_spacing: float = 0.02
    fit_scales: tuple[float, ...] = (0.85, 1.0, 1.2, 1.5, 2.0)
    fit_offsets: tuple[float, ...] = (-0.18, 0.0, 0.18)
    coverage_weight: float = 0.1
    refinements: int = 8
    refine_scale_limits: tuple[float, float] = (0.8, 1.25)


@dataclass(frozen=True, slots=True)
class Morph:
    tidied: list[Points]
    added: list[Points]


DEFAULT_SETTINGS = MorphSettings()


def _bounds(strokes: list[Points]) -> tuple[Points, Points]:
    points = np.concatenate(strokes)
    return points.min(axis=0), points.max(axis=0)


def _diagonal(strokes: list[Points]) -> float:
    low, high = _bounds(strokes)
    return float(np.hypot(*(high - low)))


def resample(stroke: Points, spacing: float) -> Points:
    """Points every `spacing` along the polyline, endpoints kept; a single point stays itself."""
    if len(stroke) < 2:
        return stroke.copy()
    steps = np.hypot(*np.diff(stroke, axis=0).T)
    travelled = np.concatenate([[0.0], np.cumsum(steps)])
    length = travelled[-1]
    if length == 0.0:
        return stroke[:1].copy()
    stations = np.linspace(0.0, length, max(2, int(np.ceil(length / spacing)) + 1))
    return np.column_stack([np.interp(stations, travelled, stroke[:, axis]) for axis in (0, 1)])


def _nearest(points: Points, targets: Points) -> tuple[NDArray[np.intp], NDArray[np.float64]]:
    distances = np.linalg.norm(points[:, None, :] - targets[None, :, :], axis=2)
    nearest = distances.argmin(axis=1)
    return nearest, distances[np.arange(len(points)), nearest]


def _misfit(player_cloud: Points, exemplar_cloud: Points, coverage_weight: float) -> float:
    """The player's ink must lie on the exemplar; the exemplar lying on their ink counts for less,
    because a drawing still under the pen covers only part of it."""
    on_exemplar = _nearest(player_cloud, exemplar_cloud)[1].mean()
    covered = _nearest(exemplar_cloud, player_cloud)[1].mean()
    return float(on_exemplar + coverage_weight * covered)


def _refined(
    exemplar: list[Points], player_cloud: Points, spacing: float, settings: MorphSettings
) -> list[Points]:
    """A few rounds of scale-and-shift least squares on nearest points; never a rotation."""
    low, high = settings.refine_scale_limits
    total_scale = 1.0
    for _ in range(settings.refinements):
        cloud = np.concatenate([resample(stroke, spacing) for stroke in exemplar])
        to_player, _ = _nearest(cloud, player_cloud)
        to_cloud, _ = _nearest(player_cloud, cloud)
        source = np.concatenate([cloud[to_cloud], cloud])
        goal = np.concatenate([player_cloud, player_cloud[to_player]])
        weights = np.concatenate(
            [
                np.full(len(player_cloud), 1.0 / len(player_cloud)),
                np.full(len(cloud), settings.coverage_weight / len(cloud)),
            ]
        )[:, None]
        source_mean = (weights * source).sum(axis=0) / weights.sum()
        goal_mean = (weights * goal).sum(axis=0) / weights.sum()
        spread = float((weights * (source - source_mean) ** 2).sum())
        if spread == 0.0:
            break
        scale = float((weights * (source - source_mean) * (goal - goal_mean)).sum() / spread)
        scale = float(np.clip(total_scale * scale, low, high)) / total_scale
        total_scale *= scale
        exemplar = [(stroke - source_mean) * scale + goal_mean for stroke in exemplar]
    return exemplar


def fit_exemplar(
    exemplar: list[Points], player: list[Points], settings: MorphSettings = DEFAULT_SETTINGS
) -> list[Points]:
    """The exemplar laid over the player's ink: uniform scale, centred, then adjusted to fit."""
    low, high = _bounds(player)
    exemplar_low, exemplar_high = _bounds(exemplar)
    exemplar_size = np.maximum(exemplar_high - exemplar_low, 1e-9)
    base_scale = float(np.min(np.maximum(high - low, 1e-9) / exemplar_size))
    centre, exemplar_centre = (low + high) / 2, (exemplar_low + exemplar_high) / 2
    diagonal = max(_diagonal(player), 1e-9)
    spacing = settings.sample_spacing * diagonal
    player_cloud = np.concatenate([resample(stroke, spacing) for stroke in player])

    def placed(scale: float, offset: Points) -> list[Points]:
        return [
            (stroke - exemplar_centre) * base_scale * scale + centre + offset for stroke in exemplar
        ]

    candidates = [
        (scale, np.array([dx, dy]) * diagonal)
        for scale in settings.fit_scales
        for dx in settings.fit_offsets
        for dy in settings.fit_offsets
    ]

    def cost(candidate: tuple[float, Points]) -> float:
        cloud = np.concatenate([resample(stroke, spacing) for stroke in placed(*candidate)])
        return _misfit(player_cloud, cloud, settings.coverage_weight)

    return _refined(placed(*min(candidates, key=cost)), player_cloud, spacing, settings)


def _smoothed(shifts: Points, window: int) -> Points:
    if len(shifts) < 3 or window < 2:
        return shifts
    width = min(window, len(shifts)) | 1
    kernel = np.hanning(width + 2)[1:-1]
    kernel /= kernel.sum()
    padded = np.pad(shifts, ((width // 2, width // 2), (0, 0)), mode="edge")
    return np.column_stack([np.convolve(padded[:, axis], kernel, mode="valid") for axis in (0, 1)])


def _tidy(stroke: Points, target: Points, diagonal: float, settings: MorphSettings) -> Points:
    nearest, distance = _nearest(stroke, target)
    shifts = target[nearest] - stroke
    shifts[distance > settings.reach * diagonal] = 0.0
    shifts = _smoothed(shifts, settings.smoothing_window) * settings.strength
    lengths = np.linalg.norm(shifts, axis=1, keepdims=True)
    limit = settings.max_shift * diagonal
    shifts *= np.minimum(1.0, limit / np.maximum(lengths, 1e-12))
    return stroke + shifts


def _uncovered_runs(covered: NDArray[np.bool_], bridge: int) -> list[tuple[int, int]]:
    """[start, end) runs of uncovered points; covered gaps up to `bridge` points do not end one."""
    runs: list[tuple[int, int]] = []
    start: int | None = None
    gap = 0
    for index, is_covered in enumerate(covered):
        if not is_covered:
            start = index if start is None else start
            gap = 0
        elif start is not None:
            gap += 1
            if gap > bridge:
                runs.append((start, index - gap + 1))
                start, gap = None, 0
    if start is not None:
        runs.append((start, len(covered) - gap))
    return runs


def _missing(
    exemplar: list[Points], player_cloud: Points, diagonal: float, settings: MorphSettings
) -> list[Points]:
    added: list[Points] = []
    spacing = settings.sample_spacing * diagonal
    for stroke in exemplar:
        dense = resample(stroke, spacing)
        covered = _nearest(dense, player_cloud)[1] <= settings.cover_radius * diagonal
        for start, end in _uncovered_runs(covered, settings.bridge_points):
            piece = dense[start:end]
            if (
                len(piece) >= 2
                and (len(piece) - 1) * spacing >= settings.min_added_length * diagonal
            ):
                added.append(piece)
    return added


def morph(
    player: list[Points], exemplar: list[Points], settings: MorphSettings = DEFAULT_SETTINGS
) -> Morph | None:
    """None when either drawing has no extent to work with."""
    player = [stroke for stroke in player if len(stroke) > 0]
    exemplar = [stroke for stroke in exemplar if len(stroke) > 0]
    if not player or not exemplar:
        return None
    diagonal = _diagonal(player)
    if not np.isfinite(diagonal) or diagonal <= 0.0 or _diagonal(exemplar) <= 0.0:
        return None
    fitted = fit_exemplar(exemplar, player, settings)
    spacing = settings.sample_spacing * diagonal
    target = np.concatenate([resample(stroke, spacing) for stroke in fitted])
    player_cloud = np.concatenate([resample(stroke, spacing) for stroke in player])
    return Morph(
        tidied=[_tidy(stroke, target, diagonal, settings) for stroke in player],
        added=_missing(fitted, player_cloud, diagonal, settings),
    )
