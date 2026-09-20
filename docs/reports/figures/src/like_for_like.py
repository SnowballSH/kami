"""On the GX10: Kami's Eye restricted to the k-NN's 42 categories, on test drawings of those categories."""
import json
from pathlib import Path

import numpy as np
import torch

from dataset import Split, load_dataset
from model import SketchNet

KNN = """mushroom|bed|rabbit|ladder|stairs|tree|fence|hot air balloon|cloud|parachute|bird|anvil|mountain|feather|leaf|snowflake|banana|nail|cake|birthday cake|wine bottle|teapot|cup|key|door|bridge|house|flower|star|moon|sun|cat|umbrella|river|candle|skull|campfire|line|circle|square|triangle|zigzag""".split("|")
MODEL = Path("artifacts/kami-eye")
data = load_dataset(Path("data/datasets/kami-eye"))
temperature = json.loads((MODEL / "preprocess.json").read_text())["temperature"]
keep = np.array([data.categories.index(name) for name in KNN if name in data.categories])
print("categories found:", len(keep), "of", len(KNN))
net = SketchNet(len(data.categories)); net.load_state_dict(torch.load(MODEL / "model.pt", map_location="cpu"))
net = net.cuda().eval()
rows = np.sort(np.flatnonzero((data.splits == Split.TEST) & np.isin(data.labels, keep)))
hits1, hits3 = [], []
with torch.no_grad(), torch.autocast("cuda", dtype=torch.float16):
    for start in range(0, len(rows), 2048):
        batch = rows[start : start + 2048]
        images = torch.from_numpy(np.ascontiguousarray(data.images[batch])).cuda().float().div_(255).unsqueeze(1)
        logits = net(images)[0].float()[:, torch.from_numpy(keep).cuda()]
        top = keep[logits.topk(3, dim=1).indices.cpu().numpy()]
        truth = data.labels[batch]
        hits1.append(top[:, 0] == truth); hits3.append((top == truth[:, None]).any(axis=1))
hits1, hits3, fraction = np.concatenate(hits1), np.concatenate(hits3), data.fractions[rows]
for name, mask in (("finished", fraction >= 1.0), ("prefix 50-70%", (fraction >= 0.5) & (fraction < 0.7)), ("prefix 30-50%", fraction < 0.5)):
    print(f"{name:14} n={mask.sum():6d}  top-1 {100 * hits1[mask].mean():.1f}%  top-3 {100 * hits3[mask].mean():.1f}%")
