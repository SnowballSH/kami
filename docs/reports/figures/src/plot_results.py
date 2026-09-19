"""On the GX10: paper-style figures for Kami's Eye from the training log and eval.npz."""
import json
import re
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

LOG, EVAL, OUT = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)

BLUE, ORANGE, GREEN, VERMILION, GREY = "#0072B2", "#E69F00", "#009E73", "#D55E00", "#666666"
SINGLE, DOUBLE = 3.4, 7.0
plt.rcParams.update({
    "font.family": "serif", "font.serif": ["STIX Two Text", "STIXGeneral", "DejaVu Serif"], "mathtext.fontset": "stix",
    "font.size": 8.5, "axes.labelsize": 8.5, "legend.fontsize": 7.5, "xtick.labelsize": 7.5, "ytick.labelsize": 7.5,
    "axes.spines.top": False, "axes.spines.right": False, "axes.linewidth": 0.6, "lines.linewidth": 1.3, "lines.markersize": 3.5,
    "axes.grid": True, "grid.color": "#DDDDDD", "grid.linewidth": 0.5, "legend.frameon": False,
    "savefig.dpi": 300, "savefig.bbox": "tight", "savefig.pad_inches": 0.02, "pdf.fonttype": 42,
})

def save(figure, name):
    for suffix in ("pdf", "png"):
        figure.savefig(OUT / f"{name}.{suffix}")
    plt.close(figure)

def panel_label(axis, letter):
    axis.text(-0.2, 1.06, f"({letter})", transform=axis.transAxes, fontweight="bold", fontsize=9, va="bottom")

# ---- Figure 1: training progress ----
epochs = [(int(e), float(l), float(a), float(b), float(s.replace(",", "")))
          for e, l, a, b, s in re.findall(r"epoch\s+(\d+)/\d+\s+loss ([\d.]+)\s+val top-1 ([\d.]+)%\s+top-3 ([\d.]+)%\s+([\d,]+) img/s", LOG.read_text())]
epoch, loss, val1, val3, speed = map(np.array, zip(*epochs))
figure, (left, right) = plt.subplots(1, 2, figsize=(DOUBLE, 2.3))
left.plot(epoch, loss, "-o", color=BLUE)
left.set_xlabel("Epoch"); left.set_ylabel("Training loss (label-smoothed CE)"); left.set_xticks(epoch); panel_label(left, "a")
right.plot(epoch, val3, "-s", color=GREEN, label="Top-3"); right.plot(epoch, val1, "-o", color=BLUE, label="Top-1")
right.set_xlabel("Epoch"); right.set_ylabel("Validation accuracy (%)"); right.set_xticks(epoch); right.set_ylim(50, 90)
right.legend(loc="lower right"); panel_label(right, "b")
figure.tight_layout(w_pad=2.0); save(figure, "fig1_training")

# ---- evaluation arrays (test split only for reported figures) ----
data = np.load(EVAL)
test = data["split"] == 2
label, fraction = data["label"][test], data["fraction"][test]
classes, probs = data["top_classes"][test], data["top_probs"][test]
right1 = classes[:, 0] == label
right3 = (classes[:, :3] == label[:, None]).any(axis=1)
finished = fraction >= 1.0
confidence = probs[:, 0]

def wilson(hits, n, z=1.96):
    p = hits / n; centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return 100 * (centre - half), 100 * (centre + half)

# ---- Figure 2: accuracy against how much of the drawing has been drawn ----
edges = np.arange(0.3, 1.0001, 0.1)
centres, acc1, acc3, counts = [], [], [], []
for low, high in zip(edges[:-1], edges[1:]):
    mask = ~finished & (fraction >= low) & (fraction < high)
    centres.append(100 * (low + high) / 2); acc1.append(100 * right1[mask].mean()); acc3.append(100 * right3[mask].mean()); counts.append(int(mask.sum()))
figure, axis = plt.subplots(figsize=(SINGLE, 2.6))
axis.plot(centres, acc3, "-s", color=GREEN, label="ResNet-18, top-3 (345 classes)")
axis.plot(centres, acc1, "-o", color=BLUE, label="ResNet-18, top-1 (345 classes)")
axis.plot([100], [100 * right3[finished].mean()], "s", color=GREEN, markerfacecolor="white"); axis.plot([100], [100 * right1[finished].mean()], "o", color=BLUE, markerfacecolor="white")
knn_x, knn_1, knn_3 = [20, 40, 60, 80, 100], [18.0, 32.7, 47.3, 58.2, 65.1], [38.1, 57.9, 69.0, 78.6, 82.9]
axis.plot(knn_x, knn_3, "--s", color=GREY, alpha=0.75, label="Prefix k-NN, top-3 (42 classes)")
axis.plot(knn_x, knn_1, "--o", color=GREY, alpha=0.45, label="Prefix k-NN, top-1 (42 classes)")
axis.set_xlabel("Share of the drawing's points shown (%)"); axis.set_ylabel("Accuracy (%)"); axis.set_xlim(15, 104); axis.set_ylim(0, 100)
axis.legend(loc="lower right", handlelength=2.2)
save(figure, "fig2_accuracy_vs_progress")

# ---- Figure 3: calibration and selective prediction ----
figure, (left, right) = plt.subplots(1, 2, figsize=(DOUBLE, 2.5))
bins = np.linspace(0, 1, 11); ece_text = []
for mask, colour, name in ((finished, BLUE, "Finished"), (~finished, ORANGE, "Partial")):
    which = np.clip(np.digitize(confidence[mask], bins) - 1, 0, 9)
    xs, ys, ece = [], [], 0.0
    for b in range(10):
        inside = which == b
        if inside.sum() < 50: continue
        xs.append(confidence[mask][inside].mean()); ys.append(right1[mask][inside].mean())
        ece += inside.mean() * abs(xs[-1] - ys[-1])
    left.plot(100 * np.array(xs), 100 * np.array(ys), "-o", color=colour, label=f"{name}, ECE {100 * ece:.1f}%")
left.plot([0, 100], [0, 100], ":", color=GREY, linewidth=0.9)
left.set_xlabel("Stated confidence (%)"); left.set_ylabel("Top-1 accuracy (%)"); left.set_xlim(0, 100); left.set_ylim(0, 100); left.set_aspect("equal")
left.legend(loc="upper left"); panel_label(left, "a")
operating = {}
for mask, colour, name in ((finished, BLUE, "Finished"), (~finished & (fraction >= 0.5), ORANGE, "Partial, 50-100% shown"), (~finished & (fraction < 0.5), VERMILION, "Partial, 30-50% shown")):
    order = np.argsort(-confidence[mask]); hits = np.cumsum(right1[mask][order]); n = np.arange(1, mask.sum() + 1)
    coverage, precision = 100 * n / mask.sum(), 100 * hits / n
    right.plot(coverage[200:], precision[200:], color=colour, label=name)
    ok = np.flatnonzero(precision[200:] >= 95.0)
    if len(ok):
        last = ok[-1] + 200
        operating[name] = {"threshold": float(confidence[mask][order][last]), "coverage": float(coverage[last]), "precision": float(precision[last])}
        right.plot(coverage[last], precision[last], "o", color=colour, markerfacecolor="white", markersize=5)
right.axhline(95, color=GREY, linestyle=":", linewidth=0.9)
right.set_xlabel("Coverage: drawings named without asking (%)"); right.set_ylabel("Precision of those names (%)"); right.set_xlim(0, 100); right.set_ylim(30, 100.5)
right.legend(loc="lower left"); panel_label(right, "b")
figure.tight_layout(w_pad=2.0); save(figure, "fig3_calibration_selective")

# ---- Figure 4: per-class accuracy on finished drawings ----
categories = data["categories"]
per_class = np.array([right1[finished & (label == k)].mean() for k in range(len(categories))]) * 100
order = np.argsort(per_class)
figure, (left, right) = plt.subplots(1, 2, figsize=(DOUBLE, 2.7), gridspec_kw={"width_ratios": [1, 1.25]})
left.hist(per_class, bins=np.arange(30, 101, 5), color=BLUE, alpha=0.85, edgecolor="white", linewidth=0.5)
left.axvline(per_class.mean(), color=VERMILION, linewidth=0.9, linestyle="--", label=f"Mean {per_class.mean():.1f}%")
left.axvline(np.median(per_class), color=GREEN, linewidth=0.9, linestyle=":", label=f"Median {np.median(per_class):.1f}%")
left.set_xlabel("Top-1 accuracy on finished drawings (%)"); left.set_ylabel("Number of categories (of 345)"); left.legend(loc="upper left"); panel_label(left, "a")
shown = list(order[:8]) + list(order[-8:])
positions = list(range(8)) + list(range(9, 17))
right.barh(positions, per_class[shown], color=[VERMILION] * 8 + [BLUE] * 8, alpha=0.85, height=0.75)
right.set_yticks(positions); right.set_yticklabels([str(categories[i]) for i in shown]); right.invert_yaxis()
right.set_xlim(0, 100); right.set_xlabel("Top-1 accuracy on finished drawings (%)"); right.grid(axis="y", visible=False); right.tick_params(axis="y", length=0)
for position, index in zip(positions, shown):
    right.text(per_class[index] + 1, position, f"{per_class[index]:.0f}", va="center", fontsize=6.5, color=GREY)
right.text(-0.42, 1.06, "(b)", transform=right.transAxes, fontweight="bold", fontsize=9, va="bottom")
figure.tight_layout(w_pad=1.5); save(figure, "fig4_per_class")

confusions = {}
wrong = finished & ~right1
for truth, guess in zip(label[wrong], classes[wrong, 0]):
    confusions[(int(truth), int(guess))] = confusions.get((int(truth), int(guess)), 0) + 1
worst = sorted(confusions.items(), key=lambda item: -item[1])[:12]
summary = {
    "epochs": [{"epoch": int(e), "loss": float(l), "valTop1": float(a), "valTop3": float(b), "imagesPerSecond": float(s)} for e, l, a, b, s in epochs],
    "test": {"n": int(test.sum()), "finished": {"n": int(finished.sum()), "top1": float(100 * right1[finished].mean()), "top3": float(100 * right3[finished].mean()), "top1CI95": wilson(right1[finished].sum(), finished.sum())}},
    "byProgress": [{"sharePercent": c, "n": n, "top1": a, "top3": b} for c, n, a, b in zip(centres, counts, acc1, acc3)],
    "namingWithoutAsking": operating,
    "perClass": {"mean": float(per_class.mean()), "median": float(np.median(per_class)), "below50": int((per_class < 50).sum()), "above90": int((per_class >= 90).sum()),
                 "worst": [[str(categories[i]), float(per_class[i])] for i in order[:8]], "best": [[str(categories[i]), float(per_class[i])] for i in order[-8:][::-1]]},
    "topConfusions": [[str(categories[t]), str(categories[g]), n] for (t, g), n in worst],
}
(OUT / "summary.json").write_text(json.dumps(summary, indent=2))
print(json.dumps({k: summary[k] for k in ("test", "namingWithoutAsking", "perClass", "topConfusions")}, indent=1))
