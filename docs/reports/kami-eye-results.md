# Kami's Eye — training run and results (2026-09-19)

One ResNet-18 (64×64, one channel, 345 Quick, Draw! categories) trained **on the ASUS GX10** to name a
sketch whether it is finished or still being drawn. Figures are in `figures/` as PDF (vector, for slides
and print) and PNG (300 dpi); `figures/summary.json` holds every number below; `figures/src/` holds the
two scripts that made them (run on the box: one GPU pass over the held-out drawings, then the plots).

| | |
|---|---|
| Data | 345 categories × 8,000 recognised drawings = 2.76 M; split by drawing id into 2,484,523 train / 137,563 validation / 137,914 test |
| Prefixes | half of all drawings are cut to a random 30–100 % of their points and re-fitted to their own bounds, so one model serves live guessing |
| Training | 8 epochs, batch 1024, AdamW + one-cycle, mixed precision, label smoothing 0.1; **49 min on the GB10 at 7,035 images/s** |
| Calibration | temperature 0.841 fitted on validation (NLL 1.207 → 1.157) |
| Serving | ONNX on the box's CPU, about 12 ms per guess |

## Headline (test split, never seen in training or tuning)

| Drawings | n | Top-1 | Top-3 |
|---|---|---|---|
| Finished | 68,865 | **81.1 %** (95 % CI 80.8–81.4) | **94.2 %** |
| 90–100 % of points | 9,906 | 81.3 % | 94.0 % |
| 70–90 % | 19,547 | 74.5 % | 90.8 % |
| 50–70 % | 19,961 | 56.9 % | 79.8 % |
| 30–50 % | 19,635 | 33.6 % | 56.9 % |

For scale: the k-NN baseline it replaces reaches 65.1 % / 82.9 % on finished drawings over **42**
categories (`prefix-knn.md`); this model is 16 points better at top-1 over **eight times** the vocabulary.
The two are not measured on the same set, so the comparison in Figure 2 is indicative only.

### Like for like with the k-NN's 42 categories

The same model with its answer restricted to the 42 categories the k-NN knows, on the test drawings of
those categories (`figures/src/like_for_like.py`, run on the box). The k-NN column is from
`prefix-knn.md`; its held-out drawings are different ones from the same dataset, its index holds 300
drawings per category against the model's 8,000, and its "ink shown" points are single values where the
model's are ranges — so read the gap, not the decimals.

| Ink shown | Kami's Eye, top-1 / top-3 | n | Prefix k-NN, top-1 / top-3 |
|---|---|---|---|
| finished | **94.0 % / 99.3 %** | 8,430 | 65.1 % / 82.9 % |
| 50–70 % (k-NN: 60 %) | 84.0 % / 97.1 % | 2,466 | 47.3 % / 69.0 % |
| 30–50 % (k-NN: 40 %) | 67.9 % / 90.2 % | 2,402 | 32.7 % / 57.9 % |

## Figures

**Figure 1 — Training progress** (`fig1_training`). (a) Training loss per epoch; (b) validation top-1 and
top-3, where half the validation drawings are partial. Accuracy is still creeping up at epoch 8: a longer
run on more data would help.

![Figure 1](figures/fig1_training.png)

**Figure 2 — Accuracy against how much has been drawn** (`fig2_accuracy_vs_progress`). Test split, 10-point
bins of the share of points shown; open markers are finished drawings. Dashed grey: the prefix k-NN on its
own 42-class held-out set. By 65 % of the ink the right answer is in the top three 84 % of the time.

![Figure 2](figures/fig2_accuracy_vs_progress.png)

**Figure 3 — Can Kami name a drawing without asking?** (`fig3_calibration_selective`). (a) Reliability:
stated confidence against observed accuracy; finished drawings are well calibrated (ECE 1.0 %), partial
ones are over-confident (ECE 6.5 %). (b) Selective prediction: naming only the most confident drawings.
Open circles mark 95 % precision: **confidence ≥ 0.80 names 65 % of finished drawings and is right 95 % of
the time**; the remaining 35 % get the three-guess question. For drawings 50–100 % complete the same
precision needs ≥ 0.90 and covers 36 %; below half the ink no threshold reaches 95 %.

![Figure 3](figures/fig3_calibration_selective.png)

**Figure 4 — Which categories are hard** (`fig4_per_class`). (a) Per-category top-1 on finished drawings:
mean 81.2 %, median 84.5 %, 97 categories at 90 % or better, 11 below 50 %. (b) The eight hardest and
easiest. The hard ones are mostly pairs people draw alike.

![Figure 4](figures/fig4_per_class.png)

**Figure 5 — Kami tidies a drawing without taking it over** (`fig5_morph_contact_sheet`). Real held-out
Quick, Draw! sketches, shaken to imitate an unsteady hand, finished and cut to their first half. Grey: the
ink sent; black: the same strokes after the morph; blue: parts added, only when the exemplar fits tightly.
The morph is as firm as Kami is sure: on finished drawings (median confidence 0.85) the median boldness is
0.81 and the largest move of any point is 6.7 % of the drawing's diagonal (never over 10 %); on half-drawn
ones (median confidence 0.40) the median boldness is 0.02 and the largest move 4.8 %. Something was added
to 4 % of finished and 21 % of half-drawn sketches. 46 ms median, 104 ms p95 per drawing on the box's CPU,
measured while a training run had the GPU and several cores.

![Figure 5](figures/fig5_morph_contact_sheet.png)

## The commonest mistakes are near-synonyms

Most frequent confusions on finished test drawings: birthday cake ↔ cake, hurricane → tornado,
bus ↔ school bus, hexagon → octagon, cup / coffee cup → mug, truck → pickup truck, violin → guitar,
police car → car, bicycle → motorbike. The game already folds several of these pairs into one word
before answering (`server/natures`), so what a player sees is somewhat better than the raw 81.1 %; that
folded accuracy has not been measured.

## Caveats

One run, one seed. Held-out drawings come from the same Quick, Draw! distribution as training — real
Apple Pencil ink on an iPad has not been evaluated. Prefixes are cut by point count, not by time.
