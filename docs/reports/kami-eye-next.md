# Kami's Eye, next — design note (2026-09-19)

> Written at HackMIT 2026 for the event's training machine, an ASUS Ascent GX10; its timings refer to it.

A proposal; nothing in it has been run. It reads `kami-eye-results.md` and the code in `ml/`, and says what
to train next on the GX10 while it is idle. The control is `kami-eye-xl` (today's recipe at 22,000
drawings per class, 10 epochs), which finishes at about 23:05 EDT. Serving stays as it is: one 64×64
one-channel raster, ONNX on the box's ARM CPU, p50 ≤ 15 ms per guess. Every gain quoted below is a prior,
not a measurement; citations are limited to work we are certain of.

## 1. Diagnosis

**1.1 The errors are diffuse.** Finished test drawings: 68,865 × 18.9 % = 12,988 errors. The twelve most
frequent confusions sum to 679, 5.2 % of them. The alias pairs among those twelve (cake, bus, cup/mug,
truck, police car) are 457 errors, so scoring on the game's folded vocabulary is worth at least +0.66
points of top-1, and plausibly little more than a point. The rest is a long tail over 345 classes: generic
levers (data, targets, stem) matter more than class-specific losses.

**1.2 The recipe is under-trained and wasteful with its data.** Training loss was still falling at epoch 8
(1.781 → 1.738). `dataset.py` renders each drawing exactly once: half of the drawings are only ever seen
finished, the other half only ever as one fixed prefix. So the finished-drawing classifier learns from half
the drawings, every prefix repeats identically each epoch, and no (prefix, finished) pair of the same
drawing exists to train on.

**1.3 The right target for a prefix.** A prefix x_t is a deterministic function of the finished drawing
x_T, hence p(y | x_t) = E[ p(y | x_T) | x_t ]. A one-hot label is an unbiased but maximum-variance sample
of the inner term; a calibrated teacher's posterior on the *finished* drawing is its Rao–Blackwellised
version: same expectation, lower variance, and the reduction is largest exactly where the finished drawing
is itself ambiguous (the sibling classes). Cross-entropy is a proper scoring rule, so both targets share a
minimiser with infinite data; the gain is finite-sample, and it is the principled form of "consistency
between a prefix and its finished drawing".

**1.4 Why partial looks are over-confident.** Label smoothing 0.1 caps trained confidence near 0.9, so the
single fitted temperature is T = 0.841 < 1: it sharpens. That is right for finished drawings (ECE 1.0 %)
and wrong for the diffuse posteriors of prefixes (ECE 6.5 %). One scalar cannot serve two regimes, and the
regime is observable: `/recognize` already carries `partial`, the Bun server already keeps two floors
(0.8 / 0.9) and already parses a `certainAbove` from the sidecar, which the sidecar does not yet send.

**1.5 Coverage at 95 % precision** is selective classification by softmax response (Geifman & El-Yaniv
2017): it depends on accuracy and on how well confidence *ranks* right above wrong; a monotone
recalibration cannot move it. Two things here hurt the ranking. Probability split between aliases (cake
0.50, birthday cake 0.45) is certainty in the game's vocabulary but fails a 0.80 floor on 345 labels. And
label smoothing erases from the logits how much a drawing resembles other classes (Müller et al. 2019);
we expect, and will test, that soft teacher targets rank better.

**1.6 Completion retrieves inside one category**, often from a half-drawn query against finished
exemplars. What matters is intra-class geometry and that a prefix lands near the finished drawings it will
become. Class-collapsing objectives — supervised contrastive, ArcFace margins, and label smoothing itself
(Müller et al. 2019; neural collapse, Papyan et al. 2020) — remove exactly that signal.

## 2. Ideas

MACs: today's net is ≈ 554 M multiply–accumulates (4 stages at 32², 16², 8², 4²; the stem is 0.6 M).

| # | Idea | Mechanism | Expected gain | Cost | Cheap ablation | Verdict |
|---|---|---|---|---|---|---|
| 0 | More data, longer schedule | 2.75× the drawings, 3.4× the image passes of the live model (Hestness et al. 2017: error falls as a power law in data until the label-noise floor) | finished +2 to +3.5 top-1, similar early | 2 h 50 GPU, already being spent | — | **control** (`kami-eye-xl`) |
| 1 | Multi-view data, early-weighted sampling | every drawing rendered finished and as one prefix in each of 30–50, 50–70, 70–100 %; each epoch draws one view per drawing with weights .40/.28/.22/.10 (today, implicitly, .50/.14/.14/.21). Twice the drawings seen finished, four times the distinct images, no identical repeats, and sampling mass moved from 70–100 % views (already as accurate as finished: 81.3 vs 81.1 at 90–100 %) to the early ones. Sampling rather than loss weights: same expectation, lower gradient variance | finished +0.5–1.5; 30–70 % +1–3 | dataset ×4 (17 GB at 3k/class, 124 GB at 22k; 766 GB free), CPU render minutes, ~120 lines in `dataset.py`/`batches.py`; no latency, no contract | arm V vs B | **short list 1** |
| 2 | Full-sketch distillation (covers prefix↔full consistency, self-distillation, sibling-aware smoothing, KD) | 0.3·CE(y) + 0.7·τ²·KL(teacher(x_T)/τ ‖ student(view)/τ), τ = 2, label smoothing off (Hinton et al. 2015). Teacher = a finished baseline's logits on the *finished* render of the same drawing, stored once as fp16 [N, 345] (5.2 GB at 22k). One mechanism gives §1.3's target for prefixes, data-driven soft labels between siblings, the born-again gain on finished drawings (Furlanello et al. 2018) and removes label smoothing (§1.4–1.6) | finished +0.5–1.5; 30–70 % +1–3; partial ECE lower before recalibration; coverage +2–6 | one teacher forward pass over the training drawings (≈ 1 min at 3k, 6–7 min at 22k); ~60 lines; no latency, no contract. Stored logits ignore the student's affine, against Beyer et al. (2022); the affine is small and the schedule short; the online variant (+⅓ step time) is the fallback | arm V+K with arm B's own model as teacher — a *peer*, as `kami-eye-xl` will be in the long run; the stronger live model as teacher would overstate the gain | **short list 2** |
| 3 | ResNet-18D stem and shortcuts (stem/stride, anti-aliasing) | conv3×3 s1 (1→32) at full resolution, then conv3×3 s2 (32→64); 2×2 average pool before the 1×1 conv in the three down-sampling shortcuts (He et al. 2019). Ink is ~1.5 px wide and today's first operation is a stride-2 conv on raw pixels — aliased sampling of thin lines (Zhang 2019); 1×1 s2 shortcuts discard ¾ of their input | +0.3–1.0 on every bucket; architectural, so it shows in short runs | +20 M MACs (+3.5 %), so ≈ +4 % latency; training −5–12 % img/s; ~30 lines; trivial ONNX; tensor and outputs unchanged | arm V+D | **short list 3** |
| 4 | Regime-aware calibration, folded scoring (covers hierarchical labels) | T fitted separately on finished and on partial validation views, chosen by `partial`; a `certainAbove` floor per regime shipped with the model; metrics and floors on alias-folded probabilities (the sum within a group is exactly the merged class's posterior; training stays on 345 labels so completion still retrieves birthday cakes for birthday cakes) | partial ECE 6.5 → ≤ 3 %; finished top-1 ≥ +0.66 by folding; coverage up by the alias mass | no GPU training; ~80 lines (`calibrate`, `export`, `recognizer`, `sidecar`, `categories/folds.json` mirroring the 9 aliases of `server/natures`); **additive** contract change: `temperaturePartial`, `certainAbove` | on the live model, from one < 60 s logit dump | **short list 4** |
| 5 | Prefix→full embedding alignment (the metric-learning term) | paired batch (finished + one prefix view of the same drawing); λ·(1 − cos(z_prefix, stopgrad z_finished)), λ = 0.5. Instance-level, so intra-class geometry survives; its minimiser is the mean finished embedding given the prefix, which is what retrieval from a half-drawn query needs; the classifier is linear in z, so it is also feature-level self-distillation | retrieval recall up clearly; S within ±0.3 | paired batches (half the distinct drawings per step), ~50 lines; no latency, no contract | arm +A, judged on the retrieval guard-rail (§4) | **short list 5** |
| 6 | `torch.compile` + bf16 + fused AdamW (`channels_last` is already on) | pointwise fusion on a bandwidth-bound GPU; no GradScaler | 1.1–1.4× img/s → 1–4 more epochs → +0.1–0.4 | 1–2 min warm-up; Triton on aarch64 may fail, the flag then falls back | two 60 s throughput probes, loss parity over 200 steps | **short list 6** |
| 7 | Bigger teacher (ResNet-34/50 → ResNet-18) | same loss as 2 with a stronger teacher; student keeps the latency | teacher +1–2 over ResNet-18, the student keeps perhaps half | 5.5–8 GPU-hours for the teacher alone | mechanism already tested by V+K | deferred to the next idle night; reuses flag 2 unchanged |
| 8 | Stroke order / time as extra channels | Sketch-a-Net's multi-channel input (Yu et al. 2017), common in the 2018 Kaggle doodle challenge: restores the order a raster discards. For a *prefix* the raster already is "what was drawn first"; channels add only order within it and the pen tip | finished +0.5–1.5; early less | a versioned `render_v2.py` beside `render.py` (whose sha256 is baked into every model), `channels`/`renderer` in `preprocess.json`, sidecar dispatch, dataset ×3, exemplars and golden rebuilt; latency < +0.5 ms | 3-channel 3k dataset, same 9-min arm | deferred: highest contract cost, smallest gain where we need it |
| 9 | 96×96 input | thin detail survives the down-sample | finished +1–2 | 2.25× latency (breaks 15 ms at the slow end), 2.25× fewer image passes per GPU-hour, renderer change | — | rejected; idea 3 buys part of it for 4 % |
| 10 | mixup / CutMix | mixtures regularise and soften targets; better raw calibration (Zhang et al. 2018; Yun et al. 2019; Thulasidasan et al. 2019) | ≤ 0 in ≤ 15 epochs over 6.8 M drawings; they pay in very long schedules (Wightman et al. 2021); their calibration edge is over models that are not recalibrated, and ours is; superposed line drawings are off-distribution; idea 2 already supplies soft targets | none | a 4-epoch arm is biased against any regulariser | rejected; revisit if the train–validation gap (now logged) exceeds 5 points |
| 11 | EMA / SWA of weights | trajectory averaging (Izmailov et al. 2018; Tarvainen & Valpola 2017) | ≤ +0.2 after a one-cycle that anneals to ≈ 0 | negligible | below what tonight's seeds can resolve | rejected for now |

## 3. Short list, ranked

1 multi-view data (`--views 4 --view-weights .40,.28,.22,.10 --view-policy resample`), 2 full-sketch
distillation (`--teacher-logits PATH --kd-alpha 0.7 --kd-temperature 2 --label-smoothing 0`), 3 ResNet-18D
(`--arch resnet18d`), 4 regime calibration and folded scoring (`--fold-map categories/folds.json`; always
on in `calibrate`/`export`), 5 embedding alignment (`--embed-align 0.5`, implies paired batches), 6
throughput (`--compile`). Order = expected gain on the metric per unit of risk; 1 comes first because 2 and
5 need its views, 4 is certain and free, 5 serves completion rather than the score.

## 4. Selection metric (fixed before any run)

All on the **validation** split, in percent, on alias-folded labels, on stratified views (every validation
drawing contributes its finished, 50–70 % and 30–50 % view, so each bucket has the full n):

**S = 0.35·top1(finished) + 0.25·top1(50–70 %) + 0.20·top3(30–50 %) + 0.20·cov95(finished)**

cov95 is the largest share of finished drawings nameable at precision ≥ 95 % by thresholding the calibrated
folded top-1 probability. Top-3 is used early because the game then shows three guesses and top-1 there is
mostly irreducible. For reference the live model scores 67.0 (test, unfolded: 81.1, 56.9, 56.9, 65.1).

*Hard constraint.* The exported `model.onnx` through `SketchRecognizer` defaults, ONNX Runtime CPU, batch 1,
on the box: p50 of 500 runs after 50 warm-ups, interleaved with the live model in the same process, must be
≤ 1.25× the live model's, and `/recognize` p50 ≤ 15 ms on an otherwise idle box. A violating arm is out
whatever its S. Tensor shape and output names may not change.

*Guard-rails* (a regression beyond noise vetoes): ECE of partial views under the partial temperature; and
retrieval — query = 50–70 % view, gallery = finished validation drawings of the same class, recall@10 of
the drawing's own finished render. The test split is read once, for the final model and the control.

## 5. Ablations — about 90 minutes of GPU after 23:05

Before 23:05, CPU only: code and unit tests on the Mac (tiny synthetic data), `rsync` **without**
`--delete`, build `data/datasets/abl-3k-v4` at `nice -n 19` with ≤ 8 workers. Names avoid the `kami-eye*`
prefix. Every arm: first 3,000 drawings per class, 4 views, 931 k training drawings × 4 epochs = 3.73 M
image passes (equal passes, paired batches included), batch 1024, AdamW 2e-3, one-cycle, seed 0; ≈ 9 min
training + 1.5 min evaluation, export and latency. Wall time is recorded: an arm slower than 1.15× must pay
for the epochs it would cost the long run.

| # | Arm | Recipe | Question |
|---|---|---|---|
| 1 | B | today's recipe (`--view-policy fixed`, legacy weights, LS 0.1, ResNet-18) | control; its finished-view logits become the peer teacher (< 60 s) |
| 2 | B′ | B, seed 1 | seed noise |
| 3 | V | B + resampled, early-weighted views | idea 1 |
| 4 | V+D | V + `resnet18d` | idea 3 |
| 5 | V+K | V + distillation from B | idea 2 |
| 6 | V+K+D | best pair | additivity |
| 7 | +A | best so far + `--embed-align 0.5` | idea 5, by the retrieval guard-rail |
| 8 | best′ | the winner, seed 1 | replication |

Plus two 60 s `--compile` probes and, offline, idea 4 on the live model. Eight slots allow **two seeds for
the control and the winner, one for everything else**. With n = 51,750 validation drawings per view the
binomial standard error is 0.2 points for a top-1 and about 0.7 for cov95, so σ_eval(S) ≈ 0.2–0.3;
seed-to-seed spread in short runs is of the same order. Until B/B′ says otherwise: **|ΔS| < 0.5 is noise,
0.5–1.0 is suggestive and needs arm 8 to agree in sign, ≥ 1.0 is accepted**; if B and B′ differ by more
than 0.5, double all three. V changes two things at once (fresh views and weights); if it wins early but
loses on finished drawings, the long run takes the legacy weights with resampling.

## 6. The long run (≈ 3.5 h)

During the ablations, on CPU: build `data/datasets/eye-next-22k-v4` (124 GB; one 4,096-byte page per image,
so watch img/s in the first minute and add prefetch threads if the GPU starves). Then one 6–7 min pass of
`kami-eye-xl` (read-only) over the finished training views for the teacher logits. Recipe = the accepted
components, 22,000 drawings per class, batch 1024, one-cycle, epochs E = ⌊0.93 · 12,600 s · R / 6.83 M⌋ with
R the winning arm's measured img/s (12 at 7,000; 14 at 8,400); artefacts to `artifacts/eye-next`. Afterwards,
CPU only: regime temperatures and floors, test-split report against `kami-eye-xl` on the same stratified
views, latency check, golden parity, `exemplars.py` rebuild (~25 min). It ships only if S(test) beats the
control by ≥ 1.0 within the latency bound; swapping the live model stays a human's decision. If no component
clears the bar, the 3.5 h go to idea 7's ResNet-34 teacher and `kami-eye-xl` ships with idea 4 applied.

## 7. Also rejected

- **SupCon / ArcFace margins** — they collapse each class to a point; completion retrieves *within* a class
  (§1.6). Idea 5 is the instance-level alternative.
- **Focal loss, logit adjustment** (Lin et al. 2017; Mukhoti et al. 2020; Menon et al. 2021) — classes are
  balanced by construction, so logit adjustment is the identity; the hard classes are hard through label
  ambiguity, which focal loss would up-weight.
- **Merged labels in training, hand-made sibling smoothing** — folding at scoring time is exact and keeps
  fine labels for completion; the teacher's soft targets learn the sibling structure from data.
- **Time-varying prefix curriculum, per-prefix loss weights** — the end-of-schedule mixture decides the
  weights; static sampling weights (idea 1) are the lower-variance form.
- **Test-time augmentation** — 2× latency for a few tenths; distillation puts such gains in the weights.
- **ResNet-34 as the served model** — ~2× latency and half the image passes in a fixed GPU budget while
  still under-trained; its place is as a teacher (idea 7).
- **Arc-length prefix cuts, prefixes under 30 %** — closer to a live pen than cuts at simplified vertices,
  but their value shows only on real iPad ink, for which no evaluation set exists yet.

## References

Beyer et al., *Knowledge distillation: a good teacher is patient and consistent*, CVPR 2022 · Furlanello et
al., *Born-again neural networks*, ICML 2018 · Geifman & El-Yaniv, *Selective classification for deep neural
networks*, NeurIPS 2017 · Guo et al., *On calibration of modern neural networks*, ICML 2017 · He et al., *Bag
of tricks for image classification with CNNs*, CVPR 2019 · Hestness et al., *Deep learning scaling is
predictable, empirically*, 2017 · Hinton, Vinyals & Dean, *Distilling the knowledge in a neural network*,
2015 · Izmailov et al., *Averaging weights leads to wider optima and better generalization*, UAI 2018 · Lin
et al., *Focal loss for dense object detection*, ICCV 2017 · Menon et al., *Long-tail learning via logit
adjustment*, ICLR 2021 · Mukhoti et al., *Calibrating deep neural networks using focal loss*, NeurIPS 2020 ·
Müller, Kornblith & Hinton, *When does label smoothing help?*, NeurIPS 2019 · Papyan, Han & Donoho,
*Prevalence of neural collapse during the terminal phase of deep learning training*, PNAS 2020 · Tarvainen &
Valpola, *Mean teachers are better role models*, NeurIPS 2017 · Thulasidasan et al., *On mixup training*,
NeurIPS 2019 · Wightman, Touvron & Jégou, *ResNet strikes back*, 2021 · Yu et al., *Sketch-a-Net: a deep
neural network that beats humans*, IJCV 2017 · Yun et al., *CutMix*, ICCV 2019 · Zhang, *Making convolutional
networks shift-invariant again*, ICML 2019 · Zhang et al., *mixup: beyond empirical risk minimization*,
ICLR 2018.
