"""An artefact directory as a recogniser: strokes -> render -> ONNX Runtime -> calibrated top-k."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from artifacts import (
    MODEL_FILE,
    TensorSpec,
    load_metadata,
    validate_tensors,
)
from onnx_runtime import ort
from render import (
    CANVAS,
    MARGIN,
    SIZE,
    THICKNESS,
    Image,
    Strokes,
    render,
    render_source_sha256,
    to_model_input,
)

INPUT_NAME = "image"
OUTPUT_NAMES = ["logits", "embedding"]
DEFAULT_TOP = 5


@dataclass(frozen=True, slots=True)
class Recognition:
    labels: list[str]
    probs: list[float]


@dataclass(frozen=True, slots=True)
class Reading:
    """Everything the model says about drawings: calibrated [N, K] and unit-length [N, 512]."""

    probabilities: NDArray[np.float64]
    embeddings: NDArray[np.float32]


def softmax(logits: NDArray[np.float32], temperature: float) -> NDArray[np.float64]:
    scaled = logits.astype(np.float64) / temperature
    exponentials = np.exp(scaled - scaled.max(axis=-1, keepdims=True))
    return np.asarray(exponentials / exponentials.sum(axis=-1, keepdims=True), dtype=np.float64)


def unit_rows(vectors: NDArray[np.float32]) -> NDArray[np.float32]:
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return np.asarray(vectors / np.where(norms > 0, norms, 1), dtype=np.float32)


class SketchRecognizer:
    def __init__(self, artifacts_dir: Path, threads: int | None = None) -> None:
        self.name = artifacts_dir.name
        artifacts_dir = artifacts_dir.resolve(strict=True)
        metadata = load_metadata(
            artifacts_dir,
            {
                "size": SIZE,
                "canvas": CANVAS,
                "margin": MARGIN,
                "thickness": THICKNESS,
                "renderSha256": render_source_sha256(),
            },
        )
        self.labels = list(metadata.labels)
        self.temperature = metadata.temperature
        self.temperature_partial = metadata.temperature_partial
        self.certain_above = metadata.certain_above
        self.render_matches = True
        options = ort.SessionOptions()
        if threads is not None:
            options.intra_op_num_threads = threads
        self._session = ort.InferenceSession(
            str(artifacts_dir / MODEL_FILE), options, providers=["CPUExecutionProvider"]
        )
        validate_tensors(
            [TensorSpec(node.name, node.type, node.shape) for node in self._session.get_inputs()],
            [TensorSpec(node.name, node.type, node.shape) for node in self._session.get_outputs()],
            len(self.labels),
        )

    def _run(self, strokes: Strokes) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
        logits, embedding = self._session.run(
            OUTPUT_NAMES, {INPUT_NAME: to_model_input(render(strokes))}
        )
        return np.asarray(logits[0], dtype=np.float32), np.asarray(embedding[0], dtype=np.float32)

    def recognize(
        self, strokes: Strokes, top: int = DEFAULT_TOP, *, partial: bool = False
    ) -> Recognition:
        """`partial` says the pen is still moving: such looks have their own temperature."""
        logits, _ = self._run(strokes)
        probabilities = softmax(logits, self.temperature_partial if partial else self.temperature)
        best = np.argsort(-probabilities)[: min(top, len(self.labels))]
        return Recognition(
            [self.labels[index] for index in best], [float(probabilities[index]) for index in best]
        )

    def read_images(self, images: Sequence[Image] | Image) -> Reading:
        logits, embeddings = self._session.run(OUTPUT_NAMES, {INPUT_NAME: to_model_input(images)})
        return Reading(
            softmax(np.asarray(logits, dtype=np.float32), self.temperature),
            unit_rows(np.asarray(embeddings, dtype=np.float32)),
        )

    def read(self, strokes: Strokes) -> Reading:
        return self.read_images(render(strokes))

    def embed(self, strokes: Strokes) -> list[float]:
        _, embedding = self._run(strokes)
        norm = float(np.linalg.norm(embedding))
        return [float(value) for value in (embedding / norm if norm > 0 else embedding)]
