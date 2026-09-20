"""Morph a sketch toward a clean exemplar: the player's strokes, tidied, plus what is missing.

Every stroke and every point of the player's survives, each moved toward the part of the exemplar
it belongs to, and the parts of the exemplar that nothing of theirs covers are added. How far is the
player's slider: from their drawing untouched, through a bounded nudge as bold as Kami is sure, to
the exemplar itself in their drawing's place. The rules are in CONTRACT.md, "Completion".
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import pairwise

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
    reach_softness: float = 0.5
    aligned_from: float = 0.5
    aligned_at: float = 0.85
    skew_weight: float = 0.05
    smoothing_window: int = 5
    pull_window: int = 9
    calm_window: int = 15
    hop_tolerance: float = 0.04
    close_stroke: float = 0.02
    far_stroke: float = 0.05
    least_reshaping: float = 0.25
    piece_scale_limits: tuple[float, float] = (0.8, 1.25)
    piece_max_turn: float = float(np.radians(15.0))
    cover_radius: float = 0.10
    min_added_length: float = 0.15
    max_misfit_to_add: float = 0.03
    max_added_share: float = 1.5
    exact_cover_radius: float = 0.04
    exact_min_added_length: float = 0.04
    touch_radius: float = 0.02
    sample_spacing: float = 0.02
    most_samples: int = 1500
    match_run: int = 8
    match_options: int = 5
    hop_weight: float = 1.0
    exact_hop_weight: float = 4.0
    fit_scales: tuple[float, ...] = (0.85, 1.0, 1.2, 1.5, 2.0)
    fit_offsets: tuple[float, ...] = (-0.18, 0.0, 0.18)
    coverage_weight: float = 0.1
    fit_stride: int = 2
    refinements: int = 16
    refine_scale_limits: tuple[float, float] = (0.8, 1.25)
    max_turn: float = float(np.radians(30.0))


DEFAULT_FIRMNESS = 0.5
UNBOUNDED = 4.0
BRIDGE_POINTS = 2


@dataclass(frozen=True, slots=True)
class Slider:
    """The player's slider, from their drawing (0) to the dataset's (1). Up to the middle it scales
    the tidying Kami would do of his own accord: `care` runs 0 to 1. Past the middle he takes
    over, whatever his certainty: `takeover` runs 0 to 1."""

    care: float
    takeover: float

    @staticmethod
    def at(firmness: float) -> Slider:
        firmness = min(1.0, max(0.0, firmness))
        return Slider(
            care=min(1.0, firmness / DEFAULT_FIRMNESS),
            takeover=max(0.0, firmness - DEFAULT_FIRMNESS) / (1.0 - DEFAULT_FIRMNESS),
        )


@dataclass(frozen=True, slots=True)
class Hand:
    """How Kami's hand moves a stroke. Distances are shares of the ink's bounding-box diagonal.
    `insistence` 0 leaves alone ink the exemplar does not explain and keeps a stroke's shape;
    1 moves everything onto the exemplar."""

    strength: float
    max_shift: float
    reach: float
    smoothing_window: int
    hop_weight: float
    insistence: float


def own_hand(boldness: float, settings: MorphSettings) -> Hand:
    """Kami's hand left to himself: bounded, and as bold as he is sure."""
    return Hand(
        strength=settings.gentle_strength
        + boldness * (settings.bold_strength - settings.gentle_strength),
        max_shift=settings.gentle_shift + boldness * (settings.bold_shift - settings.gentle_shift),
        reach=settings.reach,
        smoothing_window=settings.smoothing_window,
        hop_weight=settings.hop_weight,
        insistence=0.0,
    )


def exact_hand(settings: MorphSettings) -> Hand:
    """The hand that puts every point of the player's on the exemplar."""
    return Hand(
        strength=1.0,
        max_shift=UNBOUNDED,
        reach=UNBOUNDED,
        smoothing_window=1,
        hop_weight=settings.exact_hop_weight,
        insistence=1.0,
    )


@dataclass(frozen=True, slots=True)
class Adding:
    """What of the exemplar Kami adds. Left to himself: only long parts far from the ink, only on a
    tight fit, never more than the player's own ink allows. The limits tighten to nothing as the
    slider goes to 0 and open as it goes to 1, where every part they did not draw is added."""

    cover_radius: float
    min_added_length: float
    max_misfit: float
    max_share: float

    @staticmethod
    def at(slider: Slider, settings: MorphSettings) -> Adding:
        opening = np.inf if slider.takeover >= 1.0 else 1.0 / (1.0 - slider.takeover)

        def toward(own: float, exact: float) -> float:
            return own + slider.takeover * (exact - own)

        return Adding(
            cover_radius=toward(settings.cover_radius, settings.exact_cover_radius),
            min_added_length=toward(settings.min_added_length, settings.exact_min_added_length),
            max_misfit=settings.max_misfit_to_add * slider.care * opening,
            max_share=settings.max_added_share * slider.care * opening,
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


def _distances(points: Points, targets: Points) -> Points:
    """Every point to every target, from one matrix product rather than a cube of differences."""
    origin = targets.mean(axis=0)
    near, far = points - origin, targets - origin
    squared = (near**2).sum(axis=1)[:, None] + (far**2).sum(axis=1)[None, :] - 2.0 * near @ far.T
    apart: Points = np.sqrt(np.maximum(squared, 0.0))
    return apart


def _misfit(player_cloud: Points, exemplar_cloud: Points, coverage_weight: float) -> float:
    """The player's ink must lie on the exemplar; how much the exemplar lying on their ink counts
    is the caller's say, because a drawing still under the pen covers only part of it."""
    between = _distances(player_cloud, exemplar_cloud)
    return float(between.min(axis=1).mean() + coverage_weight * between.min(axis=0).mean())


@dataclass(frozen=True, slots=True)
class Placement:
    """A turn, a uniform scale and a shift: `points @ matrix.T + offset`."""

    matrix: Points
    offset: Points

    def of(self, points: Points) -> Points:
        placed: Points = points @ self.matrix.T + self.offset
        return placed

    def then(self, later: Placement) -> Placement:
        return Placement(later.matrix @ self.matrix, later.matrix @ self.offset + later.offset)

    @staticmethod
    def about(centre: Points, scale: float, turn: float, to: Points) -> Placement:
        """`centre` lands on `to`, everything around it scaled and turned."""
        cos, sin = np.cos(turn), np.sin(turn)
        matrix = scale * np.array([[cos, -sin], [sin, cos]])
        return Placement(matrix, to - matrix @ centre)


@dataclass(frozen=True, slots=True)
class _Pairing:
    """Weighted pairs of points reduced to what a least-squares turn, scale and shift needs."""

    source_mean: Points
    goal_mean: Points
    along: float
    across: float
    spread: float

    @staticmethod
    def of(source: Points, goal: Points, weights: NDArray[np.float64]) -> _Pairing | None:
        total = float(weights.sum())
        if total <= 0.0:
            return None
        source_mean, goal_mean = weights @ source / total, weights @ goal / total
        from_mean, to_mean = source - source_mean, goal - goal_mean
        return _Pairing(
            source_mean,
            goal_mean,
            along=float(weights @ (from_mean * to_mean).sum(axis=1)),
            across=float(
                weights @ (from_mean[:, 0] * to_mean[:, 1] - from_mean[:, 1] * to_mean[:, 0])
            ),
            spread=float(weights @ (from_mean**2).sum(axis=1)),
        )

    @property
    def turn(self) -> float:
        return float(np.arctan2(self.across, self.along))

    def scale_at(self, turn: float) -> float:
        return float((self.along * np.cos(turn) + self.across * np.sin(turn)) / self.spread)


def _refined(cloud: Points, player_cloud: Points, settings: MorphSettings) -> Placement:
    """A few rounds of least squares on nearest points: a shift, a bounded scale and a bounded
    turn, so an exemplar follows a drawing that leans without ever being stood on its head."""
    low, high = settings.refine_scale_limits
    total = Placement(np.eye(2), np.zeros(2))
    total_scale, total_turn = 1.0, 0.0
    for _ in range(settings.refinements):
        placed = total.of(cloud)
        between = _distances(player_cloud, placed)
        source = np.concatenate([placed[between.argmin(axis=1)], placed])
        goal = np.concatenate([player_cloud, player_cloud[between.argmin(axis=0)]])
        weights = np.concatenate(
            [
                np.full(len(player_cloud), 1.0 / len(player_cloud)),
                np.full(len(placed), settings.coverage_weight / len(placed)),
            ]
        )
        pairing = _Pairing.of(source, goal, weights)
        if pairing is None or pairing.spread == 0.0:
            break
        wanted_turn = total_turn + pairing.turn
        turn = float(np.clip(wanted_turn, -settings.max_turn, settings.max_turn)) - total_turn
        scale = float(np.clip(total_scale * pairing.scale_at(turn), low, high)) / total_scale
        total_scale *= scale
        total_turn += turn
        total = total.then(Placement.about(pairing.source_mean, scale, turn, pairing.goal_mean))
    return total


def _length(strokes: list[Points]) -> float:
    return float(sum(np.hypot(*np.diff(stroke, axis=0).T).sum() for stroke in strokes))


def spacing_of(strokes: list[Points], settings: MorphSettings) -> float:
    """How far apart a drawing is sampled: a share of its diagonal, or further when the ink is so
    long for its bounds (a scribble going back and forth) that it would take more than
    `most_samples` points; every cost downstream grows with that number, some with its square."""
    return max(
        settings.sample_spacing * _diagonal(strokes), _length(strokes) / settings.most_samples
    )


def _cloud(strokes: list[Points], spacing: float) -> Points:
    return np.concatenate([resample(stroke, spacing) for stroke in strokes])


def fit_exemplar(
    exemplar: list[Points], player: list[Points], settings: MorphSettings = DEFAULT_SETTINGS
) -> list[Points]:
    """The exemplar laid over the player's ink: diagonals matched and centred, the best of a small
    grid of scales and shifts, then adjusted to fit."""
    low, high = _bounds(player)
    exemplar_low, exemplar_high = _bounds(exemplar)
    centre, exemplar_centre = (low + high) / 2, (exemplar_low + exemplar_high) / 2
    diagonal = max(_diagonal(player), 1e-9)
    base_scale = diagonal / max(_diagonal(exemplar), 1e-9)
    spacing = spacing_of(player, settings)
    player_cloud = _cloud(player, spacing)
    exemplar_cloud = _cloud(exemplar, spacing / base_scale)

    def laid(scale: float, dx: float, dy: float) -> Placement:
        to = centre + np.array([dx, dy]) * diagonal
        return Placement.about(exemplar_centre, base_scale * scale, 0.0, to)

    sparse_player = player_cloud[:: settings.fit_stride]
    sparse_exemplar = exemplar_cloud[:: settings.fit_stride]
    rough = min(
        (
            laid(scale, dx, dy)
            for scale in settings.fit_scales
            for dx in settings.fit_offsets
            for dy in settings.fit_offsets
        ),
        key=lambda placement: _misfit(
            sparse_player, placement.of(sparse_exemplar), settings.coverage_weight
        ),
    )
    fitted = rough.then(_refined(rough.of(exemplar_cloud), player_cloud, settings))
    return [fitted.of(stroke) for stroke in exemplar]


def unlikeness(
    fitted: list[Points],
    player: list[Points],
    coverage_weight: float,
    settings: MorphSettings = DEFAULT_SETTINGS,
) -> float:
    """How far a fitted exemplar is from being the player's drawing, as a share of its diagonal:
    their ink off the exemplar, plus `coverage_weight` of the exemplar off their ink."""
    diagonal = max(_diagonal(player), 1e-9)
    spacing = spacing_of(player, settings)
    return _misfit(_cloud(player, spacing), _cloud(fitted, spacing), coverage_weight) / diagonal


def _smoothed(shifts: Points, window: int) -> Points:
    if len(shifts) < 3 or window < 2:
        return shifts
    width = min(window, len(shifts)) | 1
    kernel = np.hanning(width + 2)[1:-1]
    kernel /= kernel.sum()
    padded = np.pad(shifts, ((width // 2, width // 2), (0, 0)), mode="edge")
    return np.column_stack([np.convolve(column, kernel, mode="valid") for column in padded.T])


def _smoothsteps(values: NDArray[np.float64], low: float, high: float) -> NDArray[np.float64]:
    share = np.clip((values - low) / max(high - low, 1e-12), 0.0, 1.0)
    smooth: NDArray[np.float64] = share * share * (3.0 - 2.0 * share)
    return smooth


def _smoothstep(value: float, low: float, high: float) -> float:
    share = min(1.0, max(0.0, (value - low) / (high - low)))
    return share * share * (3.0 - 2.0 * share)


def boldness_of(certainty: float, misfit: float, settings: MorphSettings) -> float:
    """0 (gentle) to 1 (bold): bold only when Kami is sure what the drawing is AND the exemplar
    lies closely on the player's ink; doubt about either keeps his hand light."""
    sure = _smoothstep(certainty, settings.sure_from, settings.sure_at)
    close = 1.0 - _smoothstep(misfit, settings.loose_from, settings.loose_at)
    return sure * close


@dataclass(frozen=True, slots=True)
class Trace:
    """A drawing as points every `spacing` along its ink, each with the direction the line runs in
    there (zero for a dot)."""

    points: Points
    directions: Points

    @staticmethod
    def of(strokes: list[Points], spacing: float) -> Trace:
        dense = [resample(stroke, spacing) for stroke in strokes]
        return Trace(np.concatenate(dense), np.concatenate([_directions(one) for one in dense]))


def _directions(stroke: Points) -> Points:
    if len(stroke) < 2:
        return np.zeros_like(stroke)
    along = np.gradient(stroke, axis=0)
    lengths = np.linalg.norm(along, axis=1, keepdims=True)
    unit: Points = along / np.maximum(lengths, 1e-12)
    return unit


def _agreement(directions: Points, others: Points) -> Points:
    """|cos| of the angle between two sets of directions, [mine, theirs]; 1 where either is a dot's,
    which runs in no direction and so disagrees with none."""
    agreement = np.abs(directions @ others.T)
    undirected = ~directions.any(axis=1)[:, None] | ~others.any(axis=1)[None, :]
    agreement[undirected] = 1.0
    return agreement


def _runs_of(length: int, run: int) -> list[slice]:
    return [slice(start, min(start + run, length)) for start in range(0, length, run)]


def _along(
    stations: Trace, exemplar: Trace, diagonal: float, hand: Hand, settings: MorphSettings
) -> NDArray[np.intp]:
    """Where on the exemplar each station of a stroke belongs, as indices into the exemplar's
    points. The nearest point alone makes a line drawn between two of the exemplar's lines hop from
    one to the other and back, and pulls a line sideways onto one it merely crosses; so each
    station picks among the best point of each of its closest stretches of exemplar, a line running
    across its own direction counts as further away, and a pick that lands further from the last
    one than the pen itself travelled pays for the difference."""
    between = _distances(stations.points, exemplar.points)
    skew = 1.0 - _agreement(stations.directions, exemplar.directions)
    unfit = between + settings.skew_weight * diagonal * (1.0 - hand.insistence) * skew
    runs = _runs_of(len(exemplar.points), settings.match_run)
    best_in_run = np.stack([run.start + unfit[:, run].argmin(axis=1) for run in runs], axis=1)
    unfit_in_run = np.take_along_axis(unfit, best_in_run, axis=1)
    keep = min(settings.match_options, len(runs))
    best_runs = np.argsort(unfit_in_run, axis=1)[:, :keep]
    options = np.take_along_axis(best_in_run, best_runs, axis=1)
    costs = np.take_along_axis(unfit_in_run, best_runs, axis=1)

    travelled = np.linalg.norm(np.diff(stations.points, axis=0), axis=1)
    total = costs[0].copy()
    came_from = np.zeros_like(options)
    for index in range(1, len(options)):
        here, before = exemplar.points[options[index]], exemplar.points[options[index - 1]]
        hop = np.linalg.norm(here[:, None, :] - before[None, :, :], axis=2)
        excess = np.maximum(0.0, hop - travelled[index - 1]) * hand.hop_weight
        through = total[None, :] + excess
        came_from[index] = through.argmin(axis=1)
        total = costs[index] + through.min(axis=1)

    picks = np.empty(len(options), dtype=np.intp)
    picks[-1] = total.argmin()
    for index in range(len(options) - 1, 0, -1):
        picks[index - 1] = came_from[index, picks[index]]
    matched: NDArray[np.intp] = options[np.arange(len(options)), picks]
    return matched


def _pull(
    stations: Trace,
    exemplar: Trace,
    matched: NDArray[np.intp],
    diagonal: float,
    hand: Hand,
    settings: MorphSettings,
) -> NDArray[np.float64]:
    """How much of its shift each station takes, 0 to 1. Left to himself Kami leaves alone ink the
    exemplar does not explain: a station whose place on the exemplar is out of reach, or runs
    across the stroke rather than along it. The share fades rather than cuts off and is evened out
    over a long stretch of the stroke, because a line pulled here and left there comes out wavy.
    The player's insistence overrides all of it."""
    apart = np.linalg.norm(exemplar.points[matched] - stations.points, axis=1) / diagonal
    within_reach = 1.0 - _smoothsteps(apart, settings.reach_softness * hand.reach, hand.reach)
    agreement = np.abs((stations.directions * exemplar.directions[matched]).sum(axis=1))
    agreement[~stations.directions.any(axis=1) | ~exemplar.directions[matched].any(axis=1)] = 1.0
    aligned = _smoothsteps(agreement, settings.aligned_from, settings.aligned_at)
    own = _smoothed((within_reach * aligned)[:, None], settings.pull_window)[:, 0]
    pull: NDArray[np.float64] = own + hand.insistence * (1.0 - own)
    return pull


def _near_hops(
    stations: Points, matched: Points, diagonal: float, settings: MorphSettings
) -> NDArray[np.float64]:
    """0 to 1 per station: 1 where the stroke's place on the exemplar jumps further than the pen
    itself travelled, fading to 0 half a calm window away."""
    if len(stations) < 2:
        return np.zeros(len(stations))
    travelled = np.linalg.norm(np.diff(stations, axis=0), axis=1)
    jumped = np.linalg.norm(np.diff(matched, axis=0), axis=1)
    hops = np.concatenate([[False], jumped - travelled > settings.hop_tolerance * diagonal])
    width = settings.calm_window | 1
    kernel = np.hanning(width + 2)[1:-1]
    spread = np.convolve(hops.astype(np.float64), kernel)[width // 2 : width // 2 + len(hops)]
    near: NDArray[np.float64] = np.clip(spread, 0.0, 1.0)
    return near


def _calmed(
    shifts: Points,
    stations: Points,
    matched: Points,
    diagonal: float,
    hand: Hand,
    settings: MorphSettings,
) -> Points:
    """Shifts smoothed along the stroke so lines bend rather than jitter. Where the stroke hops
    from one of the exemplar's lines to another its two halves are pulled different ways, which
    crumples a small shape the exemplar draws elsewhere (a door, a window); there the shifts are
    evened out over a long stretch instead, so the shape moves in one piece. The player's
    insistence overrides it."""
    narrow = _smoothed(shifts, hand.smoothing_window)
    wide = _smoothed(shifts, settings.calm_window)
    near = _near_hops(stations, matched, diagonal, settings) * (1.0 - hand.insistence)
    calmed: Points = narrow + near[:, None] * (wide - narrow)
    return calmed


def _as_one_piece(
    stations: Points, places: Points, pull: NDArray[np.float64], settings: MorphSettings
) -> Points:
    """The shifts that carry the whole stroke toward its places on the exemplar without changing
    its shape: one shift, a bounded scale and a bounded turn."""
    pairing = _Pairing.of(stations, places, pull)
    if pairing is None:
        return np.zeros_like(stations)
    if pairing.spread == 0.0:
        return np.broadcast_to(pairing.goal_mean - pairing.source_mean, stations.shape).copy()
    turn = float(np.clip(pairing.turn, -settings.piece_max_turn, settings.piece_max_turn))
    scale = float(np.clip(pairing.scale_at(turn), *settings.piece_scale_limits))
    carried = Placement.about(pairing.source_mean, scale, turn, pairing.goal_mean)
    return carried.of(stations) - stations


def _reshaping(
    stations: Points, places: Points, diagonal: float, hand: Hand, settings: MorphSettings
) -> float:
    """How much of the change of shape a stroke takes, on top of being carried as one piece. A
    stroke that already lies along the exemplar is smoothed onto it; one the exemplar draws
    differently (a door, a window, an ear) keeps its shape, because bending it to another drawing's
    comes out crumpled. The player's insistence overrides it."""
    apart = float(np.linalg.norm(places - stations, axis=1).mean() / diagonal)
    differently = _smoothstep(apart, settings.close_stroke, settings.far_stroke)
    own = 1.0 - differently * (1.0 - settings.least_reshaping)
    return own + hand.insistence * (1.0 - own)


def _shifts(
    stroke: Points,
    exemplar: Trace,
    diagonal: float,
    spacing: float,
    hand: Hand,
    settings: MorphSettings,
) -> Points:
    """How far this hand moves each point of a stroke. Worked out at stations every `spacing` along
    it and read off at its own points, so a pen that reports a point every pixel is tidied like
    one that reports few."""
    steps = np.linalg.norm(np.diff(stroke, axis=0), axis=1)
    travelled = np.concatenate([[0.0], np.cumsum(steps)])
    dense = resample(stroke, spacing)
    stations = Trace(dense, _directions(dense))
    matched = _along(stations, exemplar, diagonal, hand, settings)
    places = exemplar.points[matched]
    pull = _pull(stations, exemplar, matched, diagonal, hand, settings)
    carried = _as_one_piece(stations.points, places, pull, settings) * pull.mean()
    reshaped = (places - stations.points) * pull[:, None] - carried
    reshaped = _calmed(reshaped, stations.points, places, diagonal, hand, settings)
    shifts = carried + _reshaping(stations.points, places, diagonal, hand, settings) * reshaped
    shifts *= hand.strength
    lengths = np.linalg.norm(shifts, axis=1, keepdims=True)
    shifts *= np.minimum(1.0, hand.max_shift * diagonal / np.maximum(lengths, 1e-12))
    if len(dense) < 2:
        return np.broadcast_to(shifts[0], stroke.shape).copy()
    at = np.linspace(0.0, travelled[-1], len(dense))
    return np.column_stack([np.interp(travelled, at, shifts[:, axis]) for axis in (0, 1)])


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


def _reaching_the_ink(
    distance: NDArray[np.float64], start: int, end: int, touch: float
) -> tuple[int, int]:
    """An uncovered run starts a cover radius away from the ink, which would leave the added part
    floating beside the drawing; so it grows at both ends for as long as the exemplar keeps coming
    closer to the ink, and starts where the two meet."""
    while start > 0 and distance[start] > touch and distance[start - 1] < distance[start]:
        start -= 1
    while end < len(distance) and distance[end - 1] > touch and distance[end] < distance[end - 1]:
        end += 1
    return start, end


def _missing(
    exemplar: list[Points],
    ink_cloud: Points,
    diagonal: float,
    spacing: float,
    adding: Adding,
    settings: MorphSettings,
) -> list[Points]:
    added: list[Points] = []
    for stroke in exemplar:
        dense = resample(stroke, spacing)
        distance = _distances(dense, ink_cloud).min(axis=1)
        runs = _uncovered_runs(distance <= adding.cover_radius * diagonal, BRIDGE_POINTS)
        taken = 0
        for (start, end), following in pairwise([*runs, (len(dense), len(dense))]):
            if (end - start - 1) * spacing >= adding.min_added_length * diagonal:
                first, last = _reaching_the_ink(
                    distance, start, end, settings.touch_radius * diagonal
                )
                first, last = max(first, taken), min(last, following[0])
                if last - first >= 2:
                    added.append(dense[first:last])
                    taken = last
    return added


def _worth_adding(
    missing: list[Points], inked: list[Points], misfit: float, adding: Adding
) -> list[Points]:
    """Left to himself Kami adds nothing on a loose fit (the parts would land in the wrong place)
    nor when it would be more his drawing than the player's; the slider closes both limits to
    nothing at 0 and opens them at 1."""
    if adding.max_share <= 0.0 or misfit > adding.max_misfit:
        return []
    if _length(missing) > adding.max_share * _length(inked):
        return []
    return missing


def inked_strokes(strokes: list[Points]) -> list[Points]:
    return [stroke for stroke in strokes if len(stroke) > 0]


def has_extent(strokes: list[Points]) -> bool:
    if not strokes:
        return False
    diagonal = _diagonal(strokes)
    return bool(np.isfinite(diagonal)) and diagonal > 0.0


def morph(
    player: list[Points],
    exemplar: list[Points],
    certainty: float = 1.0,
    firmness: float = DEFAULT_FIRMNESS,
    settings: MorphSettings = DEFAULT_SETTINGS,
) -> Morph | None:
    """The exemplar fitted to the player's ink, then `morph_onto` it."""
    inked, exemplar = inked_strokes(player), inked_strokes(exemplar)
    if not has_extent(inked) or not has_extent(exemplar):
        return None
    return morph_onto(
        player, fit_exemplar(exemplar, inked, settings), certainty, firmness, settings
    )


def morph_onto(
    player: list[Points],
    fitted: list[Points],
    certainty: float = 1.0,
    firmness: float = DEFAULT_FIRMNESS,
    settings: MorphSettings = DEFAULT_SETTINGS,
) -> Morph | None:
    """The player's ink morphed onto an exemplar already laid over it. None when either drawing has
    no extent to work with. `tidied` always has the player's shape: the same strokes in the same
    order, each with the same number of points."""
    inked, fitted = inked_strokes(player), inked_strokes(fitted)
    if not has_extent(inked) or not has_extent(fitted):
        return None
    diagonal = _diagonal(inked)
    spacing = spacing_of(inked, settings)
    exemplar = Trace.of(fitted, spacing)
    ink_cloud = _cloud(inked, spacing)
    misfit = float(_distances(ink_cloud, exemplar.points).min(axis=1).mean() / diagonal)
    boldness = boldness_of(certainty, misfit, settings)
    slider = Slider.at(firmness)
    own, exact = own_hand(boldness, settings), exact_hand(settings)

    def tidied_stroke(stroke: Points) -> Points:
        """Up to the middle of the slider a share of Kami's own tidying; past it, each point on
        its way from there to its place on the exemplar, so nothing ever moves back as the
        slider goes up."""
        if len(stroke) == 0 or slider.care <= 0.0:
            return stroke.copy()
        shifts = slider.care * _shifts(stroke, exemplar, diagonal, spacing, own, settings)
        if slider.takeover > 0.0:
            onto = _shifts(stroke, exemplar, diagonal, spacing, exact, settings)
            shifts += slider.takeover * (onto - shifts)
        moved: Points = stroke + shifts
        return moved

    tidied = [tidied_stroke(stroke) for stroke in player]
    adding = Adding.at(slider, settings)
    missing = _missing(
        fitted, _cloud(inked_strokes(tidied), spacing), diagonal, spacing, adding, settings
    )
    return Morph(
        tidied=tidied,
        added=_worth_adding(missing, inked, misfit, adding),
        misfit=misfit,
        boldness=boldness,
    )
