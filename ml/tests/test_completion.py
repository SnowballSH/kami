from collections.abc import Sequence
from dataclasses import dataclass, field

import numpy as np
import pytest

from completion import MIN_TOP1_PROBABILITY, SketchCompleter, category_key
from exemplar_set import EMBEDDING_SIZE, Exemplar, ExemplarSet
from morph import DEFAULT_SETTINGS
from pose import UPRIGHT
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
    assert completion.similarity == pytest.approx(0.2 / np.hypot(0.8, 0.2), abs=1e-3)
    assert completion.exemplar_key_id == 1


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
    assert completion.exemplar_key_id == 1
    assert completion.similarity == pytest.approx(0.0, abs=1e-3)


def test_an_unsure_model_and_no_known_name_is_no_answer() -> None:
    reader = ScriptedReader([0.2, 0.1, 0.49, 0.21], axis(1))
    assert completer(reader).complete(SKETCH) is None
    assert completer(reader).complete(SKETCH, "my best friend") is None


@pytest.mark.parametrize(
    "name", ["a bouncy mushroom", "big red Mushroom", "the eiffel tower mushroom"]
)
def test_a_name_with_adjectives_is_the_thing_it_ends_with(name: str) -> None:
    reader = ScriptedReader([0.7, 0.1, 0.15, 0.05], axis(0))
    completion = completer(reader).complete(SKETCH, name)
    assert completion is not None and completion.category == "mushroom"


def test_the_longest_ending_that_is_a_label_wins() -> None:
    reader = ScriptedReader([0.7, 0.1, 0.15, 0.05], axis(2))
    completion = completer(reader).complete(SKETCH, "a tall eiffel tower")
    assert completion is not None and completion.category == "The Eiffel Tower"


def test_a_category_without_exemplars_is_no_answer() -> None:
    reader = ScriptedReader([0.01, 0.01, 0.01, 0.97], axis(0))
    assert completer(reader).complete(SKETCH) is None
    assert completer(reader).complete(SKETCH, "square") is None


SKETCH_DIAGONAL = float(np.hypot(200.0, 60.0))
SLASH_AND_DOT: list[list[Point]] = [[(500.0, 100.0), (560.0, 250.0)], [(530.0, 130.0)]]


def test_the_exemplar_whose_ink_is_most_like_the_sketch_is_chosen_whatever_the_embedding() -> None:
    for embedding in (axis(0), axis(1), between(0, 1, 0.5)):
        reader = ScriptedReader([0, 0, 1, 0], embedding)
        cornered = completer(reader).complete(SKETCH)
        slashed = completer(reader).complete(SLASH_AND_DOT)
        assert cornered is not None and cornered.exemplar_key_id == 1
        assert slashed is not None and slashed.exemplar_key_id == 2


def test_the_embedding_decides_between_exemplars_that_fit_alike() -> None:
    twin = Exemplar(MUSHROOM, 0.95, 5, axis(3), [stroke([(0, 0), (255, 0), (255, 100)])])
    exemplar_set = ExemplarSet.of(LABELS, [*EXEMPLARS, twin])
    towards_first = SketchCompleter(ScriptedReader([0, 0, 1, 0], axis(0)), exemplar_set)
    towards_twin = SketchCompleter(ScriptedReader([0, 0, 1, 0], axis(3)), exemplar_set)
    first, second = towards_first.complete(SKETCH), towards_twin.complete(SKETCH)
    assert first is not None and first.exemplar_key_id == 1
    assert second is not None and second.exemplar_key_id == 5


def test_a_sketch_facing_the_other_way_gets_the_exemplar_mirrored() -> None:
    mirrored: list[list[Point]] = [[(300.0, 200.0), (100.0, 200.0), (100.0, 260.0)]]
    reader = ScriptedReader([0, 0, 1, 0], axis(0))
    as_drawn = completer(reader).complete([SKETCH[0]])
    facing_back = completer(reader).complete(mirrored)
    assert as_drawn is not None and as_drawn.pose == UPRIGHT
    assert facing_back is not None and facing_back.exemplar_key_id == 1
    assert facing_back.pose.mirrored != (facing_back.pose.quarter_turns % 2 == 1)
    for tidied, drawn in zip(facing_back.tidied, mirrored, strict=True):
        assert np.linalg.norm(tidied - np.asarray(drawn), axis=1).max() < 0.04 * SKETCH_DIAGONAL


def test_a_sketch_lying_on_its_side_gets_the_exemplar_turned() -> None:
    on_its_side: list[list[Point]] = [[(200.0, 100.0), (200.0, 300.0), (140.0, 300.0)]]
    completion = completer(ScriptedReader([0, 0, 1, 0], axis(0))).complete(on_its_side)
    assert completion is not None and completion.exemplar_key_id == 1
    assert completion.pose.quarter_turns % 2 == 1
    for tidied, drawn in zip(completion.tidied, on_its_side, strict=True):
        assert np.linalg.norm(tidied - np.asarray(drawn), axis=1).max() < 0.04 * SKETCH_DIAGONAL


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


def test_flat_ink_is_tidied_like_any_other() -> None:
    reader = ScriptedReader([0, 0, 1, 0], axis(0))
    completion = completer(reader).complete([[(0.0, 7.0), (90.0, 7.0)]], "mushroom")
    assert completion is not None and [len(one) for one in completion.tidied] == [2]


def test_an_exemplar_set_for_other_labels_is_refused() -> None:
    with pytest.raises(ValueError, match="other labels"):
        SketchCompleter(
            ScriptedReader([1.0], axis(0), labels=["circle"]), ExemplarSet.of(LABELS, EXEMPLARS)
        )


def test_the_drawing_stays_the_players_stroke_for_stroke_and_point_for_point() -> None:
    completion = completer(ScriptedReader([0, 0, 1, 0], axis(0))).complete(SKETCH)
    assert completion is not None
    assert [len(one) for one in completion.tidied] == [len(one) for one in SKETCH]
    diagonal = float(np.hypot(200.0, 60.0))
    for tidied, drawn in zip(completion.tidied, SKETCH, strict=True):
        moved = np.linalg.norm(tidied - np.asarray(drawn), axis=1)
        assert moved.max() <= DEFAULT_SETTINGS.bold_shift * diagonal + 1e-9


def test_the_answer_serialises_to_the_routes_shape() -> None:
    completion = completer(ScriptedReader([0, 0, 1, 0], axis(0))).complete(SKETCH)
    assert completion is not None
    body = completion.to_json()
    assert set(body) == {
        "tidied",
        "added",
        "category",
        "confidence",
        "similarity",
        "boldness",
        "exemplar",
        "pose",
    }
    assert body["pose"] == {"mirrored": False, "quarterTurns": 0}
    assert body["exemplar"] == str(completion.exemplar_key_id)
    assert body["tidied"] == [
        [{"x": float(x), "y": float(y)} for x, y in np.round(one, 2)] for one in completion.tidied
    ]
