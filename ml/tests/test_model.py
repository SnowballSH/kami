from pathlib import Path

import numpy as np
import onnx
import pytest

from onnx_runtime import ort

torch = pytest.importorskip("torch")

from calibrate import MAX_TEMPERATURE, fit_temperature  # noqa: E402
from export import ONNX_OPSET, export_onnx  # noqa: E402
from model import EMBEDDING_SIZE, SketchNet  # noqa: E402
from render import SIZE  # noqa: E402

CLASS_COUNT = 5


def test_forward_returns_logits_and_the_pooled_embedding() -> None:
    logits, embedding = SketchNet(CLASS_COUNT)(torch.zeros(3, 1, SIZE, SIZE))
    assert logits.shape == (3, CLASS_COUNT)
    assert embedding.shape == (3, EMBEDDING_SIZE)


def test_onnx_export_honours_the_contract_and_matches_torch(tmp_path: Path) -> None:
    model = SketchNet(CLASS_COUNT).eval()
    path = tmp_path / "model.onnx"
    export_onnx(model, path)

    assert onnx.load(str(path)).opset_import[0].version == ONNX_OPSET
    session = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    assert [(node.name, node.shape) for node in session.get_inputs()] == [
        ("image", ["batch", 1, SIZE, SIZE])
    ]
    assert [(node.name, node.shape) for node in session.get_outputs()] == [
        ("logits", ["batch", CLASS_COUNT]),
        ("embedding", ["batch", EMBEDDING_SIZE]),
    ]

    images = np.random.default_rng(0).random((4, 1, SIZE, SIZE), dtype=np.float32)
    onnx_logits, onnx_embedding = session.run(["logits", "embedding"], {"image": images})
    with torch.inference_mode():
        torch_logits, torch_embedding = model(torch.from_numpy(images))
    assert np.allclose(onnx_logits, torch_logits.numpy(), atol=1e-4)
    assert np.allclose(onnx_embedding, torch_embedding.numpy(), atol=1e-4)


def test_temperature_scaling_recovers_a_known_temperature() -> None:
    rng = np.random.default_rng(3)
    true_logits = rng.normal(0, 2, (4000, CLASS_COUNT)).astype(np.float32)
    probabilities = np.exp(true_logits) / np.exp(true_logits).sum(axis=1, keepdims=True)
    labels = np.asarray([rng.choice(CLASS_COUNT, p=row) for row in probabilities], dtype=np.int64)
    assert fit_temperature(true_logits * 3, labels) == pytest.approx(3.0, rel=0.1)
    assert fit_temperature(-true_logits * 50, labels) == MAX_TEMPERATURE
