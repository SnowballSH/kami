"""Morph a sketch toward a clean exemplar: the player's strokes, tidied, plus what is missing.

Every stroke and every point of the player's survives, each moved toward the part of the exemplar
it belongs to, and the parts of the exemplar that nothing of theirs covers are added. How far is the
player's slider: from their drawing untouched, through a bounded nudge as bold as Kami is sure, to
the exemplar itself in their drawing's place. The rules are in CONTRACT.md, "Completion".
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

Points = NDArray[np.float64]


@dataclass(frozen=True, slots=True)
class MorphSettings:
    """Distances are shares of the player's bounding-box diagonal, so the morph is scale-free."""

    gentle_strength: float = 0.5
    bold_strength: float = 0.9
    gentle_shift: float = 0.06
    bold_shift: float = 0.10
    sure_from: float = 0.3
    sure_at: float = 0.9
    loose_from: float = 0.03
    loose_at: float = 0.08
    reach: float = 0.12
    smoothing_window: int = 9
    cover_radius: float = 0.10
    min_added_length: float = 0.15
    max_misfit_to_add: float = 0.03
    max_added_share: float = 1.5
    exact_cover_radius: float = 0.04
    exact_min_added_length: float = 0.03
    sample_spacing: float = 0.02
    match_run: int = 8
    match_options: int = 5
    hop_weight: float = 1.0
    fit_scales: tuple[float, ...] = (0.85, 1.0, 1.2, 1.5, 2.0)
    fit_offsets: tuple[float, ...] = (-0.18, 0.0, 0.18)
    coverage_weight: float = 0.1
    refinements: int = 8
    refine_scale_limits: tuple[float, float] = (0.8, 1.25)


DEFAULT_FIRMNESS = 0.5
UNBOUNDED = 4.0
BRIDGE_POINTS = 2


@dataclass(frozen=True, slots=True)
class Hand:
    """How Kami's hand moves for one drawing: the player's slider and his own certainty, resolved.
    Distances are shares of the ink's bounding-box diagonal."""

    strength: float
    max_shift: float
    reach: float
    smoothing_window: int
    cover_radius: float
    min_added_length: float
    max_misfit_to_add: float
    max_added_share: float


def hand_for(firmness: float, boldness: float, settings: MorphSettings) -> Hand:
    """The slider runs from the player's drawing to the dataset's. Up to the middle it scales the
    tidying Kami would do of his own accord (0 moves nothing; 0.5 is `settings` as written, as bold
    as he is sure). Past the middle he takes over: every limit opens up until, at 1, each point of
    theirs lies on the exemplar and every part of the exemplar they did not draw is added."""
    firmness = min(1.0, max(0.0, firmness))
    care = min(1.0, firmness / DEFAULT_FIRMNESS)
    takeover = max(0.0, firmness - DEFAULT_FIRMNESS) / (1.0 - DEFAULT_FIRMNESS)
    opening = np.inf if takeover >= 1.0 else 1.0 / (1.0 - takeover)

    def toward(own: float, exemplars: float) -> float:
        return own + takeover * (exemplars - own)

    strength = settings.gentle_strength + boldness * (
        settings.bold_strength - settings.gentle_strength
    )
    shift = settings.gentle_shift + boldness * (settings.bold_shift - settings.gentle_shift)
    return Hand(
        strength=toward(care * strength, 1.0),
        max_shift=toward(care * shift, UNBOUNDED),
        reach=toward(settings.reach, UNBOUNDED),
        smoothing_window=max(1, round(toward(settings.smoothing_window, 1))),
        cover_radius=toward(settings.cover_radius, settings.exact_cover_radius),
        min_added_length=toward(settings.min_added_length, settings.exact_min_added_length),
        max_misfit_to_add=settings.max_misfit_to_add * opening,
        max_added_share=settings.max_added_share * opening,
    )


@dataclass(frozen=True, slots=True)
class Morph:
    tidied: list[Points]
    added: list[Points]
    misfit: float
    boldness: float


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
    centre, exemplar_centre = (low + high) / 2, (exemplar_low + exemplar_high) / 2
    diagonal = max(_diagonal(player), 1e-9)
    base_scale = diagonal / max(_diagonal(exemplar), 1e-9)
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


def _smoothstep(value: float, low: float, high: float) -> float:
    share = min(1.0, max(0.0, (value - low) / (high - low)))
    return share * share * (3.0 - 2.0 * share)


def boldness_of(certainty: float, misfit: float, settings: MorphSettings) -> float:
    """0 (gentle) to 1 (bold): bold only when Kami is sure what the drawing is AND the exemplar
    lies closely on the player's ink; doubt about either keeps his hand light."""
    sure = _smoothstep(certainty, settings.sure_from, settings.sure_at)
    close = 1.0 - _smoothstep(misfit, settings.loose_from, settings.loose_at)
    return sure * close


def _runs_of(target: Points, run: int) -> list[slice]:
    return [slice(start, min(start + run, len(target))) for start in range(0, len(target), run)]


def _along(stroke: Points, target: Points, settings: MorphSettings) -> Points:
    """Where on the exemplar each point of a stroke belongs. The nearest point alone makes a line
    drawn between two of the exemplar's lines hop from one to the other and back; so each point
    picks among the nearest point of each of its closest stretches of exemplar, and a pick that
    lands further from the last one than the pen itself travelled pays for the difference."""
    between = np.linalg.norm(stroke[:, None, :] - target[None, :, :], axis=2)
    runs = _runs_of(target, settings.match_run)
    closest_in_run = np.stack([run.start + between[:, run].argmin(axis=1) for run in runs], axis=1)
    apart = np.take_along_axis(between, closest_in_run, axis=1)
    keep = min(settings.match_options, len(runs))
    best_runs = np.argsort(apart, axis=1)[:, :keep]
    options = np.take_along_axis(closest_in_run, best_runs, axis=1)
    costs = np.take_along_axis(apart, best_runs, axis=1)

    travelled = np.linalg.norm(np.diff(stroke, axis=0), axis=1)
    total = costs[0].copy()
    came_from = np.zeros_like(options)
    for index in range(1, len(stroke)):
        hop = np.linalg.norm(
            target[options[index]][:, None, :] - target[options[index - 1]][None, :, :], axis=2
        )
        excess = np.maximum(0.0, hop - travelled[index - 1]) * settings.hop_weight
        through = total[None, :] + excess
        came_from[index] = through.argmin(axis=1)
        total = costs[index] + through.min(axis=1)

    picks = np.empty(len(stroke), dtype=np.intp)
    picks[-1] = total.argmin()
    for index in range(len(stroke) - 1, 0, -1):
        picks[index - 1] = came_from[index, picks[index]]
    matched: Points = target[options[np.arange(len(stroke)), picks]]
    return matched


def _tidy(
    stroke: Points, target: Points, diagonal: float, hand: Hand, settings: MorphSettings
) -> Points:
    shifts = _along(stroke, target, settings) - stroke
    shifts[np.linalg.norm(shifts, axis=1) > hand.reach * diagonal] = 0.0
    shifts = _smoothed(shifts, hand.smoothing_window) * hand.strength
    lengths = np.linalg.norm(shifts, axis=1, keepdims=True)
    shifts *= np.minimum(1.0, hand.max_shift * diagonal / np.maximum(lengths, 1e-12))
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
    exemplar: list[Points], ink_cloud: Points, diagonal: float, spacing: float, hand: Hand
) -> list[Points]:
    added: list[Points] = []
    for stroke in exemplar:
        dense = resample(stroke, spacing)
        covered = _nearest(dense, ink_cloud)[1] <= hand.cover_radius * diagonal
        for start, end in _uncovered_runs(covered, BRIDGE_POINTS):
            piece = dense[start:end]
            if len(piece) >= 2 and (len(piece) - 1) * spacing >= hand.min_added_length * diagonal:
                added.append(piece)
    return added


def _length(strokes: list[Points]) -> float:
    return float(sum(np.hypot(*np.diff(stroke, axis=0).T).sum() for stroke in strokes))


def _worth_adding(
    missing: list[Points], inked: list[Points], misfit: float, hand: Hand
) -> list[Points]:
    """Left to himself Kami adds nothing on a loose fit (the parts would land in the wrong place)
    nor when it would be more his drawing than the player's; the slider opens both limits."""
    if misfit > hand.max_misfit_to_add:
        return []
    if _length(missing) > hand.max_added_share * _length(inked):
        return []
    return missing


def morph(
    player: list[Points],
    exemplar: list[Points],
    certainty: float = 1.0,
    firmness: float = DEFAULT_FIRMNESS,
    settings: MorphSettings = DEFAULT_SETTINGS,
) -> Morph | None:
    """None when either drawing has no extent to work with. `tidied` always has the player's shape:
    the same strokes in the same order, each with the same number of points."""
    inked = [stroke for stroke in player if len(stroke) > 0]
    exemplar = [stroke for stroke in exemplar if len(stroke) > 0]
    if not inked or not exemplar:
        return None
    diagonal = _diagonal(inked)
    if not np.isfinite(diagonal) or diagonal <= 0.0 or _diagonal(exemplar) <= 0.0:
        return None
    fitted = fit_exemplar(exemplar, inked, settings)
    spacing = settings.sample_spacing * diagonal
    target = np.concatenate([resample(stroke, spacing) for stroke in fitted])
    player_cloud = np.concatenate([resample(stroke, spacing) for stroke in inked])
    misfit = float(_nearest(player_cloud, target)[1].mean() / diagonal)
    boldness = boldness_of(certainty, misfit, settings)
    hand = hand_for(firmness, boldness, settings)
    tidied = [
        _tidy(stroke, target, diagonal, hand, settings) if len(stroke) > 0 else stroke.copy()
        for stroke in player
    ]
    tidied_cloud = np.concatenate([resample(stroke, spacing) for stroke in tidied if len(stroke)])
    missing = _missing(fitted, tidied_cloud, diagonal, spacing, hand)
    return Morph(
        tidied=tidied,
        added=_worth_adding(missing, inked, misfit, hand),
        misfit=misfit,
        boldness=boldness,
    )
