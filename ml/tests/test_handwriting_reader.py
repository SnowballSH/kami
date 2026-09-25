from dataclasses import dataclass, field

import numpy as np
import pytest

from handwriting.engines import LineReading, ctc_collapse, undo_iam_spacing
from handwriting.ink import Image, Strokes
from handwriting.reader import Floors, HandwritingReader, reads_as_writing

WORD: Strokes = [[(0.0, 0.0), (0.0, 40.0)], [(20.0, 0.0), (20.0, 40.0)]]
TWO_LINES: Strokes = [*WORD, *[[(x, y + 100.0) for x, y in stroke] for stroke in WORD]]


@dataclass
class Scripted:
    """A line recogniser that answers from a script, one reading per line, and counts its reads."""

    answers: list[LineReading]
    seen: list[Image] = field(default_factory=list)

    def read(self, line: Image) -> LineReading:
        self.seen.append(line)
        return self.answers[len(self.seen) - 1]


def sure(text: str) -> LineReading:
    return LineReading(text, 0.95, 0.98)


def unsure(text: str) -> LineReading:
    return LineReading(text, 0.3, 0.6)


def hopeless(text: str) -> LineReading:
    return LineReading(text, 0.05, 0.2)


def reader_of(
    screen: list[LineReading], reader: list[LineReading]
) -> tuple[HandwritingReader, Scripted, Scripted]:
    first, second = Scripted(screen), Scripted(reader)
    return HandwritingReader(first, second, Floors()), first, second


def test_a_sure_screen_answers_alone() -> None:
    handwriting, _, reader = reader_of([sure("no gravity")], [])
    assert handwriting.read(WORD) == "no gravity"
    assert reader.seen == []


def test_an_unsure_screen_hands_the_line_to_the_reader() -> None:
    handwriting, screen, reader = reader_of([unsure("n0 grav1ty")], [sure("no gravity")])
    assert handwriting.read(WORD) == "no gravity"
    assert np.array_equal(screen.seen[0], reader.seen[0])


def test_ink_the_screen_cannot_read_as_text_is_a_drawing() -> None:
    handwriting, _, reader = reader_of([hopeless("lll")], [sure("ladder")])
    assert handwriting.read(WORD) is None
    assert reader.seen == []


def test_the_reader_must_be_sure_enough_too() -> None:
    handwriting, _, _ = reader_of([unsure("a cat")], [hopeless("a cat")])
    assert handwriting.read(WORD) is None


def test_lines_are_read_one_by_one_and_joined() -> None:
    handwriting, screen, _ = reader_of([sure("teleport us"), sure("to  the moon")], [])
    assert handwriting.read(TWO_LINES) == "teleport us to the moon"
    assert len(screen.seen) == 2


def test_one_unreadable_line_makes_the_whole_note_unreadable() -> None:
    handwriting, _, _ = reader_of([sure("teleport us"), hopeless("~~")], [])
    assert handwriting.read(TWO_LINES) is None


@pytest.mark.parametrize("text", ["IIIIII", "o", "x" * 81, ""])
def test_what_does_not_read_as_writing_is_none(text: str) -> None:
    handwriting, _, _ = reader_of([sure(text)], [])
    assert handwriting.read(WORD) is None


@pytest.mark.parametrize(
    ("text", "writing"),
    [
        ("hi", True),
        ("g = 2", True),
        ("IIII", False),
        ("60", False),
        ("--", False),
        ("é!", False),
        ("ab" * 41, False),
    ],
)
def test_reads_as_writing(text: str, writing: bool) -> None:
    assert reads_as_writing(text) is writing


@pytest.mark.parametrize(
    ("iam", "note"),
    [
        ("a farm .", "a farm"),
        ("wind 0. 3 , to the left", "wind 0.3, to the left"),
        ("stop !", "stop!"),
        ("air - 50", "air - 50"),
    ],
)
def test_iam_spacing_is_undone(iam: str, note: str) -> None:
    assert undo_iam_spacing(iam) == note


def test_ctc_merges_repeats_drops_blanks_and_keeps_each_symbols_probability() -> None:
    alphabet = ["", "h", "i", " "]
    steps = np.array(
        [
            [0.1, 0.9, 0.0, 0.0],
            [0.2, 0.8, 0.0, 0.0],
            [0.9, 0.1, 0.0, 0.0],
            [0.3, 0.0, 0.7, 0.0],
            [0.4, 0.0, 0.6, 0.0],
        ],
        dtype=np.float32,
    )
    text, sureness = ctc_collapse(steps, alphabet)
    assert text == "hi"
    assert sureness == pytest.approx([0.9, 0.7])
