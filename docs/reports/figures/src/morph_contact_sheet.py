"""On the GX10: morph real held-out Quick, Draw! sketches (finished and half-drawn) and draw a contact sheet."""
import itertools
import sys
import time
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from completion import SketchCompleter
from exemplar_set import load_exemplars_of_model
from quickdraw_bin import category_path, read_drawings
from recognizer import SketchRecognizer
from render import take_prefix

MODEL, DATA, OUT = Path("artifacts/kami-eye"), Path("data/bin"), Path(sys.argv[1])
CATEGORIES = ["mushroom", "cat", "house", "ladder", "star", "tree", "fish", "bicycle"]
HELD_OUT_AFTER, PER_CATEGORY, WORLD_SCALE = 12000, 12, 2.5
SHOWN_PER_CATEGORY = 4

recognizer = SketchRecognizer(MODEL, threads=4)
exemplars = load_exemplars_of_model(MODEL)
assert exemplars is not None
completer = SketchCompleter(recognizer, exemplars)
rng = np.random.default_rng(7)

def wobbly(strokes):
    """A shakier hand than the dataset's simplified strokes: resample and add slow noise."""
    shaken = []
    for stroke in strokes:
        points = np.asarray(stroke, dtype=np.float64)
        if len(points) < 2:
            shaken.append(points); continue
        travelled = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(points, axis=0).T))])
        stations = np.linspace(0, travelled[-1], max(2, int(travelled[-1] / 12)))
        dense = np.column_stack([np.interp(stations, travelled, points[:, axis]) for axis in (0, 1)])
        phase = rng.uniform(0, 6.28, 2)
        dense += 5.0 * np.column_stack([np.sin(stations / 35 + phase[0]), np.cos(stations / 28 + phase[1])])
        shaken.append(dense)
    return shaken

rows, stats, timings = [], [], []
for category in CATEGORIES:
    recognised = (d for d in read_drawings(category_path(DATA, category)) if d.recognized)
    for drawing in itertools.islice(recognised, HELD_OUT_AFTER, HELD_OUT_AFTER + PER_CATEGORY):
        strokes = [np.column_stack([xs, ys]).astype(np.float64) * WORLD_SCALE for xs, ys in drawing.strokes]
        for kind, ink in (("finished", wobbly(strokes)), ("half", wobbly(take_prefix(strokes, 0.5)))):
            started = time.perf_counter()
            answer = completer.complete([list(map(tuple, s)) for s in ink], category)
            timings.append(1000 * (time.perf_counter() - started))
            if answer is None:
                stats.append((kind, None)); continue
            diagonal = np.hypot(*(np.concatenate(ink).max(0) - np.concatenate(ink).min(0)))
            moved = max(float(np.linalg.norm(t - i, axis=1).max()) for t, i in zip(answer.tidied, ink))
            length = lambda ss: sum(float(np.hypot(*np.diff(s, axis=0).T).sum()) for s in ss if len(s) > 1)
            stats.append((kind, (moved / diagonal, length(answer.added) / max(length(ink), 1e-9), len(answer.added))))
            shown = sum(1 for row in rows if row[0] == category)
            if shown < SHOWN_PER_CATEGORY and (shown % 2 == (0 if kind == "finished" else 1)):
                rows.append((category, kind, ink, answer, strokes))

for kind in ("finished", "half"):
    got = [s for k, s in stats if k == kind and s is not None]
    none = sum(1 for k, s in stats if k == kind and s is None)
    moved, added, pieces = map(np.array, zip(*got))
    print(f"{kind:9} n={len(got)} declined={none}  max move/diag median {np.median(moved):.3f} max {moved.max():.3f}   added length / own ink median {np.median(added):.2f} p90 {np.percentile(added, 90):.2f}   drawings with nothing added {np.mean(pieces == 0):.0%}")
print(f"latency ms: median {np.median(timings):.1f} p95 {np.percentile(timings, 95):.1f}")

figure, axes = plt.subplots(4, 8, figsize=(16, 8.4))
for axis, (category, kind, ink, answer, whole) in zip(axes.ravel(), rows):
    if kind == "half":
        for s in whole: axis.plot(*s.T, color="#DDDDDD", linewidth=3, solid_capstyle="round")
    for s in ink: axis.plot(*s.T, color="#999999", linewidth=1.0)
    for s in answer.tidied: axis.plot(*s.T, color="#111111", linewidth=1.6)
    for s in answer.added: axis.plot(*s.T, color="#0072B2", linewidth=1.6)
    axis.set_title(f"{category} ({kind})", fontsize=9); axis.invert_yaxis(); axis.set_aspect("equal"); axis.axis("off")
for axis in axes.ravel()[len(rows):]: axis.axis("off")
figure.suptitle("grey: the player's shaky ink (light grey: the rest of their drawing, never sent)   black: tidied   blue: added by Kami", fontsize=10)
figure.tight_layout(); figure.savefig(OUT, dpi=110)
