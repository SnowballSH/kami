from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import pytest

from completion import MIN_TOP1_PROBABILITY, Bounds, SketchCompleter, category_key, place
from exemplar_set import EMBEDDING_SIZE, Exemplar, ExemplarSet
from recognizer import Reading
from render import Point, Strokes

LABELS = ["circle", "The Eiffel Tower", "mushroom", "square"]
CIRCLE, TOWER, MUSHROOM, SQUARE = range(4)
SKETCH: list[list[Point]] = [[(100.0, 200.0), (300.0, 200.0), (300.0, 260.0)], [(150.0, 210.0)]]


def axis(index: int) -> np.ndarray:
    vector = np.zeros(EMBEDDING_SIZE, dtype=np.float32)
    vector[index] = 1.0
    return vector


def between(first: int, second: int, share: float) -> np.ndarray:
    vector = share * axis(first) + (1 - share) * axis(second)
    return np.asarray(vector / np.linalg.norm(vector), dtype=np.float32)


def stroke(points: list[tuple[int, int]]) -> np.ndarray:
    return np.asarray(points, dtype=np.uint8)


EXEMPLARS = [
    Exemplar(MUSHROOM, 0.95, 1, axis(0), [stroke([(0, 0), (255, 0), (255, 100)])]),
    Exemplar(MUSHROOM, 0.95, 2, axis(1), [stroke([(0, 0), (100, 255)]), stroke([(50, 50)])]),
    Exemplar(TOWER, 0.99, 3, axis(2), [stroke([(10, 0), (60, 250)])]),
    Exemplar(CIRCLE, 0.92, 4, axis(0), [stroke([(0, 0), (200, 200)])]),
]


@dataclass
class ScriptedReader:
    """Says what the test tells it to, and counts how often it was asked."""

    probabilities: list[float]
    embedding: np.ndarray
    labels: Sequence[str] = field(default_factory=lambda: LABELS)
    reads: int = 0

    def read(self, strokes: Strokes) -> Reading:
        self.reads += 1
        return Reading(
            np.asarray([self.probabilities], dtype=np.float64), self.embedding.reshape(1, -1)
        )


def completer(reader: ScriptedReader) -> SketchCompleter:
    return SketchCompleter(reader, ExemplarSet.of(LABELS, EXEMPLARS))


def test_the_named_category_wins_over_what_the_model_sees() -> None:
    reader = ScriptedReader([0.7, 0.1, 0.15, 0.05], between(1, 0, 0.8))
    completion = completer(reader).complete(SKETCH, "mushroom")
    assert completion is not None
    assert completion.category == "mushroom"
    assert completion.confidence == pytest.approx(0.15)
    assert completion.similarity == pytest.approx(0.8 / np.hypot(0.8, 0.2), abs=1e-3)
    assert len(completion.strokes) == 2


@pytest.mark.parametrize("name", ["a mushroom", "The  Mushroom", " MUSHROOM ", "an mushroom"])
def test_names_are_compared_without_article_case_or_spacing(name: str) -> None:
    reader = ScriptedReader([0.7, 0.1, 0.15, 0.05], axis(0))
    completion = completer(reader).complete(SKETCH, name)
    assert completion is not None and completion.category == "mushroom"


def test_a_label_with_an_article_of_its_own_is_found_either_way() -> None:
    assert category_key("The Eiffel Tower") == category_key("eiffel tower") == "eiffel tower"
    reader = ScriptedReader([0.7, 0.1, 0.15, 0.05], axis(2))
    for name in ("Eiffel Tower", "the eiffel tower"):
        completion = completer(reader).complete(SKETCH, name)
        assert completion is not None and completion.category == "The Eiffel Tower"


@pytest.mark.parametrize("name", [None, "", "my best friend", "mushrooms"])
def test_without_a_known_name_the_models_sure_top_1_is_used(name: str | None) -> None:
    reader = ScriptedReader([0.2, 0.1, MIN_TOP1_PROBABILITY, 0.2], axis(1))
    completion = completer(reader).complete(SKETCH, name)
    assert completion is not None
    assert completion.category == "mushroom"
    assert completion.confidence == pytest.approx(MIN_TOP1_PROBABILITY)
    assert completion.similarity == pytest.approx(1.0, abs=1e-3)


def test_an_unsure_model_and_no_known_name_is_no_answer() -> None:
    reader = ScriptedReader([0.2, 0.1, 0.49, 0.21], axis(1))
    assert completer(reader).complete(SKETCH) is None
    assert completer(reader).complete(SKETCH, "my best friend") is None


def test_a_category_without_exemplars_is_no_answer() -> None:
    reader = ScriptedReader([0.01, 0.01, 0.01, 0.97], axis(0))
    assert completer(reader).complete(SKETCH) is None
    assert completer(reader).complete(SKETCH, "square") is None


def test_the_exemplar_most_like_the_sketch_is_chosen() -> None:
    towards_second = ScriptedReader([0, 0, 1, 0], between(1, 0, 0.6))
    towards_first = ScriptedReader([0, 0, 1, 0], between(0, 1, 0.6))
    second = completer(towards_second).complete(SKETCH)
    first = completer(towards_first).complete(SKETCH)
    assert second is not None and len(second.strokes) == 2
    assert first is not None and len(first.strokes) == 1


def test_a_surer_exemplar_wins_only_when_likeness_is_almost_equal() -> None:
    surer = Exemplar(MUSHROOM, 1.0, 5, axis(1), [stroke([(0, 0), (9, 9)])] * 3)
    exemplar_set = ExemplarSet.of(LABELS, [*EXEMPLARS, surer])
    level = SketchCompleter(ScriptedReader([0, 0, 1, 0], axis(1)), exemplar_set).complete(SKETCH)
    apart = SketchCompleter(
        ScriptedReader([0, 0, 1, 0], between(0, 1, 0.6)), exemplar_set
    ).complete(SKETCH)
    assert level is not None and len(level.strokes) == 3
    assert apart is not None and len(apart.strokes) == 1


@pytest.mark.parametrize(
    "strokes",
    [
        [],
        [[]],
        [[(5.0, 5.0)]],
        [[(5.0, 5.0), (5.0, 5.0)], [(5.0, 5.0)]],
        [[(0.0, float("nan")), (1.0, 1.0)]],
        [[(0.0, float("inf")), (1.0, 1.0)]],
    ],
)
def test_degenerate_ink_is_no_answer_and_never_reaches_the_model(strokes: Strokes) -> None:
    reader = ScriptedReader([0, 0, 1, 0], axis(0))
    assert completer(reader).complete(strokes, "mushroom") is None
    assert reader.reads == 0


def test_flat_ink_cannot_hold_an_exemplar_that_is_not_flat() -> None:
    reader = ScriptedReader([0, 0, 1, 0], axis(0))
    assert completer(reader).complete([[(0.0, 7.0), (90.0, 7.0)]], "mushroom") is None


def test_an_exemplar_set_for_other_labels_is_refused() -> None:
    with pytest.raises(ValueError, match="other labels"):
        SketchCompleter(
            ScriptedReader([1.0], axis(0), labels=["circle"]), ExemplarSet.of(LABELS, EXEMPLARS)
        )


def bounds_of(strokes: Strokes) -> Bounds:
    bounds = Bounds.of(strokes)
    assert bounds is not None
    return bounds


def test_a_wide_exemplar_fills_the_width_and_is_centred_in_the_height() -> None:
    onto = Bounds(np.asarray([100.0, 200.0]), np.asarray([300.0, 400.0]))
    placed = place([stroke([(0, 0), (255, 0), (255, 100)])], onto)
    assert placed is not None
    half_height = 50 * 200 / 255
    assert len(placed) == 1
    assert np.asarray(placed[0]) == pytest.approx(
        np.asarray(
            [[100.0, 300 - half_height], [300.0, 300 - half_height], [300.0, 300 + half_height]]
        ),
        abs=0.01,
    )


def test_a_tall_exemplar_fills_the_height_and_is_centred_in_the_width() -> None:
    onto = Bounds(np.asarray([-50.0, -1000.0]), np.asarray([50.0, -900.0]))
    placed = bounds_of(place([stroke([(10, 0), (60, 250)])], onto) or [])
    assert placed.size == pytest.approx([20.0, 100.0], abs=0.01)
    assert placed.centre == pytest.approx(onto.centre, abs=0.01)


@pytest.mark.parametrize("seed", range(20))
def test_placement_keeps_the_aspect_is_centred_and_stays_inside(seed: int) -> None:
    rng = np.random.default_rng(seed)
    lengths = rng.integers(2, 9, 3).tolist()
    exemplar = [rng.integers(0, 256, (length, 2)).astype(np.uint8) for length in lengths]
    corner = rng.uniform(-5000, 5000, 2)
    onto = Bounds(corner, corner + rng.uniform(0.37, 900, 2))
    source = bounds_of(exemplar)

    placed_strokes = place(exemplar, onto)
    assert placed_strokes is not None
    placed = bounds_of(placed_strokes)

    assert [len(one) for one in placed_strokes] == [len(one) for one in exemplar]
    assert np.all(placed.low >= onto.low) and np.all(placed.high <= onto.high)
    assert placed.centre == pytest.approx(onto.centre, abs=0.011)
    scales = placed.size / source.size
    assert scales[0] == pytest.approx(scales[1], abs=0.02 / source.size.min())
    assert np.isclose(placed.size, onto.size, atol=0.011).any()


def test_a_dot_of_an_exemplar_cannot_be_placed() -> None:
    onto = Bounds(np.zeros(2), np.ones(2))
    assert place([stroke([(9, 9)])], onto) is None
    assert place([], onto) is None


def test_the_answer_serialises_to_the_routes_shape() -> None:
    completion = completer(ScriptedReader([0, 0, 1, 0], axis(0))).complete(SKETCH)
    assert completion is not None
    body = completion.to_json()
    assert set(body) == {"strokes", "category", "confidence", "similarity"}
    assert body["strokes"] == [[{"x": x, "y": y} for x, y in one] for one in completion.strokes]
