"""Text that carries, for each of its characters, how sure a recogniser was of it.

Every edit the readers make to what a model read (trimming, undoing IAM's spacing, collapsing
whitespace, joining lines) goes through here, so the sureness stays aligned with the characters.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

WHITESPACE = re.compile(r"\s+")
SEPARATOR_SURENESS = 1.0


@dataclass(frozen=True, slots=True)
class SureText:
    text: str
    sureness: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.text) != len(self.sureness):
            raise ValueError("one sureness per character")

    @classmethod
    def uniform(cls, text: str, sureness: float) -> SureText:
        return cls(text, (sureness,) * len(text))

    def slice(self, start: int, end: int) -> SureText:
        return SureText(self.text[start:end], self.sureness[start:end])

    def strip(self) -> SureText:
        start = len(self.text) - len(self.text.lstrip())
        return self.slice(start, len(self.text.rstrip()))

    def keep_groups(self, pattern: re.Pattern[str]) -> SureText:
        """Each match replaced by its groups, in order: `(\\d)(\\.) (\\d)` keeps "0." and "3"."""
        pieces: list[SureText] = []
        at = 0
        for match in pattern.finditer(self.text):
            pieces.append(self.slice(at, match.start()))
            pieces.extend(
                self.slice(match.start(group), match.end(group))
                for group in range(1, (pattern.groups or 0) + 1)
                if match.start(group) >= 0
            )
            at = match.end()
        pieces.append(self.slice(at, len(self.text)))
        return joined(pieces)

    def collapse_whitespace(self) -> SureText:
        pieces: list[SureText] = []
        at = 0
        for match in WHITESPACE.finditer(self.text):
            pieces.append(self.slice(at, match.start()))
            pieces.append(SureText(" ", (min(self.sureness[match.start() : match.end()]),)))
            at = match.end()
        pieces.append(self.slice(at, len(self.text)))
        return joined(pieces).strip()


def joined(pieces: Iterable[SureText], separator: str = "") -> SureText:
    parts = list(pieces)
    text = separator.join(part.text for part in parts)
    sureness: list[float] = []
    for index, part in enumerate(parts):
        if index > 0:
            sureness.extend([SEPARATOR_SURENESS] * len(separator))
        sureness.extend(part.sureness)
    return SureText(text, tuple(sureness))
