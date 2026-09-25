"""The two pretrained line recognisers, each an ONNX Runtime session over a rendered line.

- `CtcLineRecogniser`: PP-OCRv5 English mobile (Apache-2.0), CTC over a 48 px high strip. Fast, and
  sure of itself only on writing that looks like text.
- `TrOcrLineRecogniser`: TrOCR-small-handwritten (MIT), int8, a ViT encoder and an autoregressive
  decoder trained on IAM. Slower, much better on messy handwriting.
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray

from handwriting.ink import Image
from handwriting.sources import (
    READER_DECODER,
    READER_ENCODER,
    READER_TOKENIZER,
    SCREEN_CHARACTERS,
    SCREEN_MODEL,
)

CTC_HEIGHT = 48
CTC_MIN_WIDTH = 16
TROCR_SIZE = 384
TROCR_START = 2
TROCR_END = 2
TROCR_SPECIAL = frozenset({0, 1, 2, 3})
TROCR_MAX_TOKENS = 48
WORD_START = "▁"


@dataclass(frozen=True, slots=True)
class LineReading:
    """What a recogniser read, with the probability of its least and its typical sure symbol."""

    text: str
    weakest: float
    typical: float


class LineRecogniser(Protocol):
    def read(self, line: Image) -> LineReading: ...


def session_options(threads: int | None) -> ort.SessionOptions:
    """Lean on memory: no arena to keep the largest line ever read, no prepacked weight copies."""
    options = ort.SessionOptions()
    options.log_severity_level = 3
    options.inter_op_num_threads = 1
    options.enable_cpu_mem_arena = False
    options.add_session_config_entry("session.disable_prepacking", "1")
    if threads is not None:
        options.intra_op_num_threads = threads
    return options


def open_session(path: Path, options: ort.SessionOptions) -> ort.InferenceSession:
    return ort.InferenceSession(str(path), options, providers=["CPUExecutionProvider"])


def as_rgb_tensor(line: Image, width: int, height: int, interpolation: int) -> NDArray[np.float32]:
    """[1, 3, height, width], scaled to -1 (ink) .. 1 (paper), as both models were trained."""
    resized = cv2.resize(line, (width, height), interpolation=interpolation)
    grey = resized.astype(np.float32) / 127.5 - 1.0
    return np.ascontiguousarray(np.broadcast_to(grey, (1, 3, height, width)))


def ctc_collapse(
    probabilities: NDArray[np.float32], alphabet: list[str]
) -> tuple[str, list[float]]:
    """Greedy CTC: best symbol per step, repeats merged, blanks (index 0) dropped."""
    best = probabilities.argmax(axis=-1)
    text: list[str] = []
    sureness: list[float] = []
    previous = 0
    for step, symbol in enumerate(best.tolist()):
        if symbol != previous and symbol != 0:
            text.append(alphabet[symbol] if symbol < len(alphabet) else "")
            sureness.append(float(probabilities[step, symbol]))
        previous = symbol
    return "".join(text), sureness


def reading_of(text: str, sureness: list[float]) -> LineReading:
    if not sureness:
        return LineReading(text, 0.0, 0.0)
    typical = math.exp(sum(math.log(max(value, 1e-12)) for value in sureness) / len(sureness))
    return LineReading(text, min(sureness), typical)


class CtcLineRecogniser:
    def __init__(self, directory: Path, threads: int | None) -> None:
        characters = (directory / SCREEN_CHARACTERS.name).read_text(encoding="utf-8").splitlines()
        self._alphabet = ["", *characters, " "]
        self._session = open_session(directory / SCREEN_MODEL.name, session_options(threads))
        self._input = self._session.get_inputs()[0].name

    def read(self, line: Image) -> LineReading:
        height, width = line.shape
        scaled_width = max(CTC_MIN_WIDTH, math.ceil(CTC_HEIGHT * width / height))
        tensor = as_rgb_tensor(line, scaled_width, CTC_HEIGHT, cv2.INTER_LINEAR)
        (probabilities,) = self._session.run(None, {self._input: tensor})
        steps = np.asarray(probabilities[0], dtype=np.float32)
        text, sureness = ctc_collapse(steps, self._alphabet)
        return reading_of(text.strip(), sureness)


IAM_SPACING = (
    (re.compile(r"\s+([.,;:!?)])"), r"\1"),
    (re.compile(r"(\d)\. (\d)"), r"\1.\2"),
    (re.compile(r"[.\s]+$"), ""),
)


def undo_iam_spacing(text: str) -> str:
    """IAM spaces out punctuation ("moon ." "0. 3") and TrOCR learned to; notes do not."""
    for pattern, replacement in IAM_SPACING:
        text = pattern.sub(replacement, text)
    return text.strip()


def log_softmax(logits: NDArray[np.float32]) -> NDArray[np.float64]:
    shifted = logits.astype(np.float64) - float(logits.max())
    return np.asarray(shifted - math.log(float(np.exp(shifted).sum())), dtype=np.float64)


class TrOcrLineRecogniser:
    def __init__(self, directory: Path, threads: int | None) -> None:
        options = session_options(threads)
        self._encoder = open_session(directory / READER_ENCODER.name, options)
        self._decoder = open_session(directory / READER_DECODER.name, options)
        tokenizer = json.loads((directory / READER_TOKENIZER.name).read_text(encoding="utf-8"))
        self._pieces: list[str] = [piece for piece, _ in tokenizer["model"]["vocab"]]
        self._past_inputs = [
            node for node in self._decoder.get_inputs() if node.name.startswith("past_key_values")
        ]
        self._outputs = [node.name for node in self._decoder.get_outputs()]

    def read(self, line: Image) -> LineReading:
        pixels = as_rgb_tensor(line, TROCR_SIZE, TROCR_SIZE, cv2.INTER_CUBIC)
        (hidden,) = self._encoder.run(None, {"pixel_values": pixels})
        tokens, sureness = self._decode(np.asarray(hidden, dtype=np.float32))
        return reading_of(undo_iam_spacing(self.detokenize(tokens)), sureness)

    def detokenize(self, tokens: list[int]) -> str:
        pieces = (self._pieces[token] for token in tokens if token not in TROCR_SPECIAL)
        return "".join(pieces).replace(WORD_START, " ").strip()

    def _decode(self, hidden: NDArray[np.float32]) -> tuple[list[int], list[float]]:
        """Greedy decoding with the key/value cache of the merged decoder's second branch."""
        past: dict[str, NDArray[np.float32]] = {
            node.name: np.zeros((1, node.shape[1], 0, node.shape[3]), dtype=np.float32)
            for node in self._past_inputs
        }
        tokens = [TROCR_START]
        sureness: list[float] = []
        cached = False
        for _ in range(TROCR_MAX_TOKENS):
            outputs = self._decoder.run(
                self._outputs,
                {
                    "input_ids": np.array([tokens[-1:] if cached else tokens], dtype=np.int64),
                    "encoder_hidden_states": hidden,
                    "use_cache_branch": np.array([cached]),
                    **past,
                },
            )
            log_probabilities = log_softmax(np.asarray(outputs[0][0, -1], dtype=np.float32))
            token = int(log_probabilities.argmax())
            sureness.append(math.exp(float(log_probabilities[token])))
            for name, value in zip(self._outputs[1:], outputs[1:], strict=True):
                if not (cached and ".encoder." in name):
                    past[name.replace("present", "past_key_values")] = value
            cached = True
            if token == TROCR_END:
                break
            tokens.append(token)
        return tokens[1:], sureness
