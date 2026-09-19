"""An artefact directory as a recogniser: strokes -> render -> ONNX Runtime -> calibrated top-k."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import onnxruntime as ort
from numpy.typing import NDArray

from render import Strokes, render, render_source_sha256, to_model_input

MODEL_FILE = "model.onnx"
LABELS_FILE = "labels.json"
PREPROCESS_FILE = "preprocess.json"
INPUT_NAME = "image"
OUTPUT_NAMES = ["logits", "embedding"]
DEFAULT_TOP = 5


@dataclass(frozen=True, slots=True)
class Recognition:
    labels: list[str]
    probs: list[float]


def softmax(logits: NDArray[np.float32], temperature: float) -> NDArray[np.float64]:
    scaled = logits.astype(np.float64) / temperature
    exponentials = np.exp(scaled - scaled.max())
    return np.asarray(exponentials / exponentials.sum(), dtype=np.float64)


class SketchRecognizer:
    def __init__(self, artifacts_dir: Path) -> None:
        preprocess = json.loads((artifacts_dir / PREPROCESS_FILE).read_text())
        self.name = artifacts_dir.resolve().name
        self.labels: list[str] = json.loads((artifacts_dir / LABELS_FILE).read_text())
        self.temperature = float(preprocess["temperature"])
        self.render_matches = preprocess.get("renderSha256") == render_source_sha256()
        self._session = ort.InferenceSession(
            str(artifacts_dir / MODEL_FILE), providers=["CPUExecutionProvider"]
        )

    def _run(self, strokes: Strokes) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
        logits, embedding = self._session.run(
            OUTPUT_NAMES, {INPUT_NAME: to_model_input(render(strokes))}
        )
        return np.asarray(logits[0], dtype=np.float32), np.asarray(embedding[0], dtype=np.float32)

    def recognize(self, strokes: Strokes, top: int = DEFAULT_TOP) -> Recognition:
        logits, _ = self._run(strokes)
        probabilities = softmax(logits, self.temperature)
        best = np.argsort(-probabilities)[: min(top, len(self.labels))]
        return Recognition(
            [self.labels[index] for index in best], [float(probabilities[index]) for index in best]
        )

    def embed(self, strokes: Strokes) -> list[float]:
        _, embedding = self._run(strokes)
        norm = float(np.linalg.norm(embedding))
        return [float(value) for value in (embedding / norm if norm > 0 else embedding)]
