"""On the GX10: run Kami's Eye over the validation and test splits on the GPU and keep every prediction."""
import json
from pathlib import Path

import numpy as np
import torch

from dataset import Split, load_dataset
from model import SketchNet

MODEL = Path("artifacts/kami-eye")
data = load_dataset(Path("data/datasets/kami-eye"))
temperature = json.loads((MODEL / "preprocess.json").read_text())["temperature"]
net = SketchNet(len(data.categories))
net.load_state_dict(torch.load(MODEL / "model.pt", map_location="cpu"))
net = net.cuda().eval().to(memory_format=torch.channels_last)

held = np.sort(np.flatnonzero(data.splits != Split.TRAIN))
top_classes, top_probs = [], []
with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
    for start in range(0, len(held), 4096):
        batch = held[start : start + 4096]
        images = torch.from_numpy(np.ascontiguousarray(data.images[batch])).cuda().float().div_(255).unsqueeze(1)
        logits, _ = net(images.contiguous(memory_format=torch.channels_last))
        probs = torch.softmax(logits.float() / temperature, dim=1)
        p, c = probs.topk(5, dim=1)
        top_probs.append(p.cpu().numpy()); top_classes.append(c.cpu().numpy())

np.savez_compressed(
    MODEL / "eval.npz",
    split=data.splits[held], label=data.labels[held], fraction=data.fractions[held],
    top_classes=np.concatenate(top_classes).astype(np.int16), top_probs=np.concatenate(top_probs).astype(np.float32),
    categories=np.array(data.categories),
)
label, classes = data.labels[held], np.concatenate(top_classes)
print("rows", len(held), "top-1", float((classes[:, 0] == label).mean()), "top-3", float((classes[:, :3] == label[:, None]).any(axis=1).mean()))
