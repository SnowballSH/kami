"""A tiny real ONNX model with the contract's input and output names, for sidecar tests."""

from pathlib import Path

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

from render import SIZE

TINY_LABELS = ["circle", "square", "triangle", "star", "line", "cloud", "mushroom"]
TINY_TEMPERATURE = 1.7
EMBEDDING_SIZE = 512
ONNX_OPSET = 17
ONNX_IR_VERSION = 8


def build_tiny_model(path: Path) -> None:
    rng = np.random.default_rng(7)
    to_embedding = rng.normal(0, 0.05, (SIZE * SIZE, EMBEDDING_SIZE)).astype(np.float32)
    to_logits = rng.normal(0, 0.5, (EMBEDDING_SIZE, len(TINY_LABELS))).astype(np.float32)
    graph = helper.make_graph(
        [
            helper.make_node("Flatten", ["image"], ["flat"], axis=1),
            helper.make_node("MatMul", ["flat", "to_embedding"], ["embedding"]),
            helper.make_node("MatMul", ["embedding", "to_logits"], ["logits"]),
        ],
        "tiny-eye",
        [helper.make_tensor_value_info("image", TensorProto.FLOAT, ["batch", 1, SIZE, SIZE])],
        [
            helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["batch", len(TINY_LABELS)]),
            helper.make_tensor_value_info(
                "embedding", TensorProto.FLOAT, ["batch", EMBEDDING_SIZE]
            ),
        ],
        [
            numpy_helper.from_array(to_embedding, "to_embedding"),
            numpy_helper.from_array(to_logits, "to_logits"),
        ],
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", ONNX_OPSET)])
    model.ir_version = ONNX_IR_VERSION
    onnx.checker.check_model(model)
    onnx.save(model, str(path))
