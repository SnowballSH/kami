"""Strokes -> the words they say, or None for a drawing or anything the readers are unsure of.

Each line of writing is read twice at most (ml/HANDWRITING.md has the measurements behind this):
the CTC screen decides whether it reads as text at all and answers alone when it is sure of every
symbol; otherwise TrOCR reads it, and its answer stands only if it is sure enough on average. A
transcript keeps how sure the models were of each character, and what the screen read wherever
TrOCR answered instead: the Bun server proofreads with both.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from handwriting.bundle import verify_bundle
from handwriting.engines import CtcLineRecogniser, LineRecogniser, TrOcrLineRecogniser
from handwriting.ink import Strokes, render_line, split_lines
from handwriting.sureness import SureText, joined

MODEL_NAME = "ppocrv5-en-mobile+trocr-small-handwritten-int8"
MAX_TEXT_LENGTH = 80
MIN_DISTINCT_SYMBOLS = 2
WHITESPACE = re.compile(r"\s+")
LINE_SEPARATOR = " "


@dataclass(frozen=True, slots=True)
class Floors:
    """`screen`: the screen's typical sureness below which ink is not writing; `trusted`: its
    weakest symbol from which it answers alone; `reader`: TrOCR's typical sureness to answer."""

    screen: float = 0.4
    trusted: float = 0.8
    reader: float = 0.4


DEFAULT_FLOORS = Floors()


@dataclass(frozen=True, slots=True)
class LineRead:
    """One line as answered, and what the screen read of it when TrOCR answered instead."""

    answer: SureText
    screened: str


@dataclass(frozen=True, slots=True)
class Transcript:
    """The words, how sure the models were of each character of them, and other readings of the
    whole note that differ from it (the screen's, where TrOCR answered), best first."""

    text: str
    sureness: tuple[float, ...]
    alternatives: tuple[str, ...] = ()

    def to_json(self) -> dict[str, object]:
        return {
            "text": self.text,
            "sureness": [round(value, 3) for value in self.sureness],
            "alternatives": list(self.alternatives),
        }


def reads_as_writing(text: str) -> bool:
    """server/transcribe/types.ts's rule (a line's worth, two different symbols), and a letter:
    the wheels of a drawn bicycle read as "60" far more often than anyone writes a bare number."""
    symbols = {character for character in text.lower() if character.isalnum()}
    return (
        0 < len(text) <= MAX_TEXT_LENGTH
        and len(symbols) >= MIN_DISTINCT_SYMBOLS
        and any(character.isalpha() for character in symbols)
    )


def tidy(text: str) -> str:
    return WHITESPACE.sub(" ", text).strip()


class HandwritingReader:
    def __init__(
        self, screen: LineRecogniser, reader: LineRecogniser, floors: Floors = DEFAULT_FLOORS
    ) -> None:
        self._screen = screen
        self._reader = reader
        self._floors = floors
        self.name = MODEL_NAME

    @classmethod
    def load(cls, directory: Path, threads: int | None = None) -> HandwritingReader:
        directory = verify_bundle(directory)
        return cls(CtcLineRecogniser(directory, threads), TrOcrLineRecogniser(directory, threads))

    def read(self, strokes: Strokes) -> Transcript | None:
        lines: list[LineRead] = []
        for line in split_lines(strokes):
            read = self._read_line(line)
            if read is None:
                return None
            lines.append(read)
        answer = joined((line.answer for line in lines), LINE_SEPARATOR).collapse_whitespace()
        if not reads_as_writing(answer.text):
            return None
        screened = tidy(LINE_SEPARATOR.join(line.screened for line in lines))
        alternatives = (screened,) if screened != answer.text and reads_as_writing(screened) else ()
        return Transcript(answer.text, answer.sureness, alternatives)

    def _read_line(self, strokes: Strokes) -> LineRead | None:
        image = render_line(strokes)
        screened = self._screen.read(image)
        screened_text = tidy(screened.text)
        if screened.typical < self._floors.screen or not reads_as_writing(screened_text):
            return None
        if screened.weakest >= self._floors.trusted:
            return LineRead(screened.sure_text().collapse_whitespace(), screened_text)
        reading = self._reader.read(image)
        if reading.typical < self._floors.reader:
            return None
        return LineRead(reading.sure_text().collapse_whitespace(), screened_text)
