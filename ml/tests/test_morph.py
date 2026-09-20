from __future__ import annotations

import numpy as np
import pytest
from numpy.typing import NDArray

from morph import (
    DEFAULT_SETTINGS,
    Adding,
    MorphSettings,
    Slider,
    boldness_of,
    exact_hand,
    morph,
    morph_onto,
    own_hand,
    resample,
    spacing_of,
)

Points = NDArray[np.float64]
CENTRE = np.array([400.0, 300.0])
RADIUS = 100.0
DIAGONAL = float(np.hypot(2 * RADIUS, 2 * RADIUS))


def arc(start: float, end: float, count: int = 60, wobble: float = 0.0) -> Points:
    """An unsteady hand: the radius wanders slowly, as a shaky line does, not point by point."""
    angles = np.linspace(start, end, count)
    radii = RADIUS + wobble * (np.sin(5 * angles) + 0.6 * np.sin(9 * angles + 1.0))
    return CENTRE + np.column_stack([radii * np.cos(angles), radii * np.sin(angles)])


def unit_circle() -> list[Points]:
    angles = np.linspace(0.0, 2 * np.pi, 80)
    return [127.5 + 127.5 * np.column_stack([np.cos(angles), np.sin(angles)])]


def radial_error(stroke: Points) -> float:
    return float(np.abs(np.linalg.norm(stroke - CENTRE, axis=1) - RADIUS).mean())


def test_resample_keeps_the_ends_and_the_spacing() -> None:
    line = np.array([[0.0, 0.0], [10.0, 0.0]])
    dense = resample(line, 1.0)
    assert np.allclose(dense[0], line[0]) and np.allclose(dense[-1], line[-1])
    assert np.allclose(np.diff(dense[:, 0]), 1.0)
    assert len(resample(line[:1], 1.0)) == 1


def test_a_wobbly_circle_is_tidied_but_stays_the_players() -> None:
    player = [arc(0.0, 2 * np.pi, count=180, wobble=6.0)]
    result = morph(player, unit_circle())
    assert result is not None
    assert [len(stroke) for stroke in result.tidied] == [180]
    assert radial_error(result.tidied[0]) < 0.75 * radial_error(player[0])
    moved = np.linalg.norm(result.tidied[0] - player[0], axis=1)
    assert moved.max() <= DEFAULT.bold_shift * DIAGONAL * 1.05 + 1e-9
    assert result.added == []


def test_half_a_circle_gets_a_whole_circle_of_the_right_size_around_it() -> None:
    from morph import fit_exemplar

    fitted = np.concatenate(fit_exemplar(unit_circle(), [arc(np.pi, 2 * np.pi)]))
    centre = (fitted.min(axis=0) + fitted.max(axis=0)) / 2
    radius = float((fitted.max(axis=0) - fitted.min(axis=0)).mean() / 2)
    assert abs(radius - RADIUS) < 0.15 * RADIUS
    assert float(np.linalg.norm(centre - CENTRE)) < 0.2 * RADIUS


def test_only_the_missing_half_is_added_and_it_reaches_the_ink_rather_than_floating() -> None:
    player = [arc(np.pi, 2 * np.pi)]
    result = morph(player, unit_circle())
    assert result is not None and len(result.added) >= 1
    cover = DEFAULT.cover_radius * float(np.hypot(2 * RADIUS, RADIUS))
    for part in result.added:
        ends = part[[0, -1]]
        gaps = np.linalg.norm(ends[:, None, :] - result.tidied[0][None, :, :], axis=2).min(axis=1)
        assert gaps.max() < 0.75 * cover
    added = np.concatenate(result.added)
    assert (added[:, 1] > CENTRE[1] - 0.3 * RADIUS).all()


def test_nothing_is_added_on_a_loose_fit() -> None:
    zigzag = [
        np.column_stack([np.linspace(300, 500, 40), 300 + 60 * np.sign(np.sin(np.arange(40)))])
    ]
    result = morph(zigzag, unit_circle())
    assert result is not None
    assert result.misfit > DEFAULT.max_misfit_to_add and result.added == []


def test_ink_the_exemplar_does_not_have_is_left_alone() -> None:
    flag = np.array([[700.0, 300.0], [760.0, 300.0], [760.0, 340.0]])
    player = [arc(0.0, 2 * np.pi, count=90, wobble=4.0), flag]
    settings = MorphSettings(fit_scales=(1.0,), fit_offsets=(0.0,))
    exemplar = [np.column_stack([u[:, 0] * (200 / 360), u[:, 1]]) for u in unit_circle()]
    result = morph(player, exemplar, settings=settings)
    assert result is not None
    assert len(result.tidied) == 2 and result.tidied[1].shape == flag.shape


def test_strength_zero_changes_nothing() -> None:
    player = [arc(0.0, 2 * np.pi, wobble=5.0)]
    still = MorphSettings(gentle_strength=0.0, bold_strength=0.0)
    result = morph(player, unit_circle(), settings=still)
    assert result is not None and np.allclose(result.tidied[0], player[0])


def test_the_surer_kami_is_the_more_firmly_he_tidies() -> None:
    player = [arc(0.0, 2 * np.pi, count=180, wobble=6.0)]
    unsure = morph(player, unit_circle(), certainty=0.2)
    sure = morph(player, unit_circle(), certainty=0.95)
    assert unsure is not None and sure is not None
    assert unsure.boldness == 0.0 and sure.boldness > 0.8
    assert radial_error(sure.tidied[0]) < 0.6 * radial_error(unsure.tidied[0])
    gentle_reach = np.linalg.norm(unsure.tidied[0] - player[0], axis=1).max()
    assert gentle_reach <= DEFAULT.gentle_shift * DIAGONAL * 1.05 + 1e-9


def test_a_loose_fit_keeps_his_hand_light_however_sure_he_is() -> None:
    assert boldness_of(0.99, DEFAULT.loose_at, DEFAULT) == 0.0
    assert boldness_of(0.99, DEFAULT.loose_from, DEFAULT) > 0.95
    assert boldness_of(DEFAULT.sure_from, 0.0, DEFAULT) == 0.0
    assert 0.0 < boldness_of(0.6, 0.03, DEFAULT) < 1.0


@pytest.mark.parametrize(
    "player",
    [[], [np.empty((0, 2))], [np.array([[5.0, 5.0]])], [np.array([[5.0, 5.0], [5.0, 5.0]])]],
)
def test_nothing_to_work_with_gives_no_answer(player: list[Points]) -> None:
    assert morph(player, unit_circle()) is None


def test_an_empty_exemplar_gives_no_answer() -> None:
    assert morph([arc(0.0, 1.0)], []) is None


DEFAULT = MorphSettings()


def test_the_players_slider_scales_how_firmly_he_tidies() -> None:
    player = [arc(0.0, 2 * np.pi, count=180, wobble=6.0)]
    errors = []
    for firmness in (0.0, 0.25, 0.5, 1.0):
        result = morph(player, unit_circle(), certainty=0.95, firmness=firmness)
        assert result is not None
        errors.append(radial_error(result.tidied[0]))
    assert errors[0] == pytest.approx(radial_error(player[0]))
    assert errors[0] > errors[1] > errors[2] > errors[3]


def test_the_slider_is_care_up_to_the_middle_and_takeover_past_it() -> None:
    assert Slider.at(0.0) == Slider(care=0.0, takeover=0.0)
    assert Slider.at(0.25) == Slider(care=0.5, takeover=0.0)
    assert Slider.at(0.5) == Slider(care=1.0, takeover=0.0)
    assert Slider.at(0.75) == Slider(care=1.0, takeover=0.5)
    assert Slider.at(1.0) == Slider.at(7.0) == Slider(care=1.0, takeover=1.0)


def test_kamis_own_hand_is_as_bold_as_he_is_sure_and_the_exact_hand_has_no_limits() -> None:
    gentle, bold = own_hand(0.0, DEFAULT_SETTINGS), own_hand(1.0, DEFAULT_SETTINGS)
    assert gentle.strength == pytest.approx(DEFAULT_SETTINGS.gentle_strength)
    assert bold.strength == pytest.approx(DEFAULT_SETTINGS.bold_strength)
    assert bold.max_shift == pytest.approx(DEFAULT_SETTINGS.bold_shift)
    assert bold.reach == pytest.approx(DEFAULT_SETTINGS.reach) and bold.insistence == 0.0

    exact = exact_hand(DEFAULT_SETTINGS)
    assert exact.strength == 1.0 and exact.smoothing_window == 1 and exact.insistence == 1.0
    assert exact.max_shift > 1.0 and exact.reach > 1.0
    assert exact.hop_weight == pytest.approx(DEFAULT_SETTINGS.exact_hop_weight)


def test_what_is_added_closes_to_nothing_at_zero_and_opens_to_everything_at_one() -> None:
    at_rest = Adding.at(Slider.at(0.5), DEFAULT_SETTINGS)
    assert at_rest.max_misfit == pytest.approx(DEFAULT_SETTINGS.max_misfit_to_add)
    assert at_rest.max_share == pytest.approx(DEFAULT_SETTINGS.max_added_share)
    assert at_rest.cover_radius == pytest.approx(DEFAULT_SETTINGS.cover_radius)

    none, half = (
        Adding.at(Slider.at(0.0), DEFAULT_SETTINGS),
        Adding.at(Slider.at(0.25), DEFAULT_SETTINGS),
    )
    assert none.max_misfit == 0.0 and none.max_share == 0.0
    assert 0.0 < half.max_share < at_rest.max_share

    full = Adding.at(Slider.at(1.0), DEFAULT_SETTINGS)
    assert full.max_misfit == np.inf and full.max_share == np.inf
    assert full.cover_radius == pytest.approx(DEFAULT_SETTINGS.exact_cover_radius)


def test_at_zero_nothing_moves_and_nothing_is_added_even_where_the_middle_adds() -> None:
    drawn = np.column_stack([np.zeros(20), np.linspace(0.0, 100.0, 20)])
    beside = np.column_stack([np.full(20, 60.0), np.linspace(0.0, 100.0, 20)])
    at_rest = morph_onto([drawn], [drawn, beside], certainty=1.0, firmness=0.5)
    untouched = morph_onto([drawn], [drawn, beside], certainty=1.0, firmness=0.0)
    assert at_rest is not None and len(at_rest.added) == 1
    assert untouched is not None and untouched.added == []
    assert np.array_equal(untouched.tidied[0], drawn)


def test_no_point_ever_moves_back_as_the_slider_goes_up() -> None:
    rng = np.random.default_rng(3)
    player = [arc(0.0, 2 * np.pi, count=90, wobble=7.0) + rng.normal(0.0, 1.5, (90, 2))]
    tidied = [
        result.tidied[0]
        for firmness in np.linspace(0.0, 1.0, 51)
        if (result := morph(player, unit_circle(), certainty=0.95, firmness=float(firmness)))
    ]
    assert len(tidied) == 51
    from_the_ink = np.stack([np.linalg.norm(one - player[0], axis=1) for one in tidied[:26]])
    to_the_exemplar = np.stack([np.linalg.norm(one - tidied[-1], axis=1) for one in tidied[25:]])
    assert (np.diff(from_the_ink, axis=0) >= -1e-9).all()
    assert (np.diff(to_the_exemplar, axis=0) <= 1e-9).all()


def test_a_scribble_far_longer_than_its_bounds_is_sampled_within_the_budget() -> None:
    corners = np.array([[0.0, 0.0], [300.0, 200.0]])
    scribble = [np.tile(corners, (512, 1)) + CENTRE]
    spacing = spacing_of(scribble, DEFAULT_SETTINGS)
    assert sum(len(resample(stroke, spacing)) for stroke in scribble) <= (
        DEFAULT_SETTINGS.most_samples + 2
    )
    result = morph(scribble, unit_circle(), firmness=1.0)
    assert result is not None and len(result.tidied[0]) == 1024
    assert np.isfinite(result.tidied[0]).all()


def test_two_parts_added_from_one_stroke_never_overlap() -> None:
    rail = np.column_stack([np.linspace(0.0, 255.0, 120), np.full(120, 128.0)])
    drawn = [FRAME + CENTRE, (rail[55:65] + CENTRE)]
    result = morph_onto(drawn, [FRAME + CENTRE, rail + CENTRE], certainty=1.0, firmness=1.0)
    assert result is not None and len(result.added) == 2
    left, right = sorted(result.added, key=lambda part: part[:, 0].min())
    assert left[:, 0].max() <= right[:, 0].min()


def test_at_full_firmness_the_drawing_becomes_the_exemplar_however_unsure_kami_is() -> None:
    from morph import fit_exemplar

    player = [arc(0.0, np.pi, count=90, wobble=9.0)]
    result = morph(player, unit_circle(), certainty=0.0, firmness=1.0)
    assert result is not None
    assert [len(stroke) for stroke in result.tidied] == [len(stroke) for stroke in player]

    spacing = DEFAULT_SETTINGS.sample_spacing * DIAGONAL
    fitted = np.concatenate(
        [resample(stroke, spacing) for stroke in fit_exemplar(unit_circle(), player)]
    )
    inked = (*result.tidied, *result.added)
    drawn = np.concatenate([resample(stroke, spacing) for stroke in inked])
    between = np.linalg.norm(drawn[:, None, :] - fitted[None, :, :], axis=2)
    assert between.min(axis=1).max() < 0.02 * DIAGONAL
    assert between.min(axis=0).max() < 0.06 * DIAGONAL


def test_with_the_slider_at_rest_an_unsure_kami_still_adds_nothing_to_a_loose_fit() -> None:
    player = [arc(0.0, np.pi, count=90, wobble=9.0)]
    result = morph(player, unit_circle(), certainty=0.0, firmness=0.5)
    assert result is not None
    assert result.added == [] or result.misfit <= DEFAULT_SETTINGS.max_misfit_to_add


def test_a_line_between_two_of_the_exemplars_lines_settles_on_one_and_does_not_hop() -> None:
    xs = np.linspace(0.0, 255.0, 60)
    rails = [np.column_stack([xs, np.full_like(xs, y)]) for y in (100.0, 140.0)]
    frame = [np.array([[0.0, 0.0], [255.0, 0.0], [255.0, 255.0], [0.0, 255.0], [0.0, 0.0]])]
    sway = 120.0 + 3.0 * np.sin(np.linspace(0.0, 40.0, 120))
    player = [
        frame[0] + CENTRE,
        np.column_stack([np.linspace(10.0, 245.0, 120), sway]) + CENTRE,
    ]
    result = morph(player, [*frame, *rails], certainty=1.0, firmness=1.0)
    assert result is not None
    heights = result.tidied[1][:, 1]
    assert np.ptp(heights) < 0.05 * np.ptp(player[0][:, 1])


def test_a_leaning_drawing_gets_a_leaning_exemplar() -> None:
    from morph import fit_exemplar

    square = np.array([[0.0, 0.0], [255.0, 0.0], [255.0, 255.0], [0.0, 255.0], [0.0, 0.0]])
    roof = np.array([[0.0, 0.0], [127.5, -120.0], [255.0, 0.0]])
    lean = np.radians(15.0)
    turn = np.array([[np.cos(lean), -np.sin(lean)], [np.sin(lean), np.cos(lean)]])
    player = [resample(stroke, 8.0) @ turn.T + CENTRE for stroke in (square, roof)]

    fitted = fit_exemplar([square, roof], player)
    floor = fitted[0][1] - fitted[0][0]
    assert np.degrees(np.arctan2(floor[1], floor[0])) == pytest.approx(15.0, abs=3.0)


def test_the_fit_never_turns_further_than_it_is_allowed() -> None:
    from morph import fit_exemplar

    bar = [np.array([[0.0, 0.0], [255.0, 0.0]]), np.array([[0.0, 0.0], [0.0, 40.0]])]
    steep = np.radians(70.0)
    turn = np.array([[np.cos(steep), -np.sin(steep)], [np.sin(steep), np.cos(steep)]])
    player = [resample(stroke, 8.0) @ turn.T + CENTRE for stroke in bar]

    fitted = fit_exemplar(bar, player)
    along = fitted[0][1] - fitted[0][0]
    turned = abs(np.degrees(np.arctan2(along[1], along[0])))
    assert turned <= np.degrees(DEFAULT_SETTINGS.max_turn) + 1e-6


FRAME = np.array([[0.0, 0.0], [255.0, 0.0], [255.0, 255.0], [0.0, 255.0], [0.0, 0.0]])


def framed(*inside: Points) -> list[Points]:
    return [FRAME + CENTRE, *(stroke + CENTRE for stroke in inside)]


def test_a_pen_that_reports_every_pixel_is_tidied_like_one_that_reports_few() -> None:
    sparse = arc(0.0, 2 * np.pi, count=60, wobble=6.0)
    dense = resample(sparse, 1.0)
    few, many = morph([sparse], unit_circle()), morph([dense], unit_circle())
    assert few is not None and many is not None
    assert radial_error(many.tidied[0]) == pytest.approx(radial_error(few.tidied[0]), abs=0.6)


def test_a_line_that_merely_crosses_the_exemplars_is_not_dragged_along_it() -> None:
    rail = np.column_stack([np.linspace(0.0, 255.0, 60), np.full(60, 128.0)])
    crossing = np.column_stack([np.full(40, 120.0), np.linspace(60.0, 200.0, 40)])
    player = framed(rail + np.array([0.0, 4.0]), crossing)
    left_alone = morph(player, [FRAME, rail], certainty=1.0)
    taken_over = morph(player, [FRAME, rail], certainty=1.0, firmness=1.0)
    assert left_alone is not None and taken_over is not None
    assert np.abs(left_alone.tidied[2] - player[2]).max() < 0.01 * DIAGONAL
    assert np.ptp(taken_over.tidied[2][:, 1]) < 0.2 * np.ptp(player[2][:, 1])


def test_a_line_at_the_edge_of_reach_does_not_come_out_wavy() -> None:
    rail = np.column_stack([np.linspace(0.0, 255.0, 60), np.full(60, 128.0)])
    edge = DEFAULT_SETTINGS.reach * float(np.hypot(255.0, 255.0))
    xs = np.linspace(10.0, 245.0, 160)
    hovering = np.column_stack([xs, 128.0 + edge * (0.8 + 0.25 * np.sin(xs / 12.0))])
    player = framed(hovering)
    result = morph(player, [FRAME, rail], certainty=1.0)
    assert result is not None

    def bends(line: Points) -> float:
        return float(np.abs(np.diff(line[:, 1], n=2)).sum())

    assert bends(result.tidied[1]) <= 1.05 * bends(player[1])


def test_a_small_shape_the_exemplar_draws_elsewhere_moves_in_one_piece() -> None:
    def box(left: float, top: float, size: float) -> Points:
        corners = np.array([[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0], [0.0, 0.0]])
        return resample(corners * size + np.array([left, top]), 3.0)

    player = framed(box(60.0, 150.0, 60.0))
    result = morph(player, [FRAME, box(85.0, 165.0, 45.0)], certainty=1.0)
    assert result is not None
    before, after = player[1], result.tidied[1]
    sides = np.linalg.norm(np.diff(after, axis=0), axis=1)
    assert sides.max() < 2.0 * np.linalg.norm(np.diff(before, axis=0), axis=1).max()
    width, height = np.ptp(after, axis=0)
    assert width / height == pytest.approx(1.0, abs=0.2)
