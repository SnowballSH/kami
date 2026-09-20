import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from artifacts import (
    REQUIRED_FILES,
    TensorSpec,
    load_metadata,
    publish_bundle,
    seal_bundle,
    validate_bundle,
    validate_tensors,
)

RENDERER: dict[str, int | str] = {
    "size": 64,
    "canvas": 256,
    "margin": 12,
    "thickness": 6,
    "renderSha256": "renderer",
}


def bundle(directory: Path) -> None:
    (directory / "model.onnx").write_bytes(b"mock model; never executed")
    (directory / "labels.json").write_text('["circle", "square"]')
    (directory / "preprocess.json").write_text(json.dumps({**RENDERER, "temperature": 1.0}))
    (directory / "golden.json").write_text('[{"mock": true}]')
    seal_bundle(directory)


class ArtifactTests(unittest.TestCase):
    def test_publication_retains_previous_and_resolves_readers_once(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / "eye"
            publish_bundle(destination, bundle)
            previous = destination.resolve()
            identity = validate_bundle(previous)
            publish_bundle(destination, bundle)
            self.assertNotEqual(previous, destination.resolve())
            self.assertEqual(validate_bundle(previous), identity)
            self.assertEqual(validate_bundle(destination), identity)

    def test_interrupted_build_or_link_swap_preserves_previous(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            destination = Path(root) / "eye"
            publish_bundle(destination, bundle)
            previous = destination.resolve()

            def broken(directory: Path) -> None:
                (directory / "model.onnx").write_bytes(b"partial")
                raise OSError("interrupted export")

            with self.assertRaises(OSError):
                publish_bundle(destination, broken)
            with (
                patch("artifacts.Path.replace", side_effect=OSError("interrupted activation")),
                self.assertRaises(OSError),
            ):
                publish_bundle(destination, bundle)
            self.assertEqual(destination.resolve(), previous)
            self.assertEqual(list(previous.parent.iterdir()), [previous])
            validate_bundle(destination)

    def test_legacy_directory_is_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            bundle(directory)
            with self.assertRaisesRegex(ValueError, "new name"):
                publish_bundle(directory, bundle)
            validate_bundle(directory)

    def test_missing_and_mixed_artifacts_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for name in REQUIRED_FILES:
                with self.subTest(name=name):
                    bundle(directory)
                    (directory / name).unlink()
                    with self.assertRaises(ValueError):
                        validate_bundle(directory)
                    bundle(directory)
                    (directory / name).write_bytes(b"different release")
                    with self.assertRaises(ValueError):
                        validate_bundle(directory)

    def test_invalid_metadata_is_rejected_before_model_loading(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            for temperature in (0, -1, True, "1", float("inf"), float("nan")):
                bundle(directory)
                (directory / "preprocess.json").write_text(
                    json.dumps({**RENDERER, "temperature": temperature})
                )
                with self.subTest(temperature=temperature), self.assertRaises(ValueError):
                    load_metadata(directory, RENDERER)
            for key in RENDERER:
                bundle(directory)
                (directory / "preprocess.json").write_text(
                    json.dumps({**RENDERER, "temperature": 1, key: "mismatch"})
                )
                with self.subTest(key=key), self.assertRaises(ValueError):
                    load_metadata(directory, RENDERER)
            for labels in ([], ["circle", "circle"], ["circle", 2], [""]):
                bundle(directory)
                (directory / "labels.json").write_text(json.dumps(labels))
                with self.subTest(labels=labels), self.assertRaises(ValueError):
                    load_metadata(directory, RENDERER)
            bundle(directory)
            self.assertEqual(load_metadata(directory, RENDERER).labels, ("circle", "square"))

    def test_output_class_count_and_renderer_tensor_contract(self) -> None:
        image = TensorSpec("image", "tensor(float)", ["batch", 1, 64, 64])
        logits = TensorSpec("logits", "tensor(float)", ["batch", 2])
        embedding = TensorSpec("embedding", "tensor(float)", ["batch", 512])
        validate_tensors([image], [logits, embedding], 2)
        with self.assertRaises(ValueError):
            validate_tensors([image], [logits, embedding], 3)
        with self.assertRaises(ValueError):
            validate_tensors([image], [embedding, logits], 2)
        for invalid in (
            TensorSpec("image", "tensor(double)", image.shape),
            TensorSpec("image", "tensor(float)", [2, 1, 64, 64]),
            TensorSpec("image", "tensor(float)", ["batch", 3, 32, 32]),
        ):
            with self.assertRaises(ValueError):
                validate_tensors([invalid], [logits, embedding], 2)
