"""A trained artefact directory back as a PyTorch model, for re-evaluation and re-export."""

from __future__ import annotations

import json
from pathlib import Path

import torch

from artifacts import LABELS_FILE, PREPROCESS_FILE, read_object
from export import CHECKPOINT_FILE
from model import Arch, SketchNet


def load_trained(artifacts_dir: Path, device: torch.device) -> tuple[SketchNet, tuple[str, ...]]:
    """The model in eval mode and its labels; artefacts from before `arch` are ResNet-18."""
    labels = tuple(json.loads((artifacts_dir / LABELS_FILE).read_text()))
    arch = Arch(str(read_object(artifacts_dir / PREPROCESS_FILE).get("arch", Arch.RESNET18.value)))
    model = SketchNet(len(labels), arch)
    weights = torch.load(artifacts_dir / CHECKPOINT_FILE, map_location="cpu", weights_only=True)
    model.load_state_dict(weights)
    if device.type == "cuda":
        model.to(memory_format=torch.channels_last)
    return model.to(device).eval(), labels
