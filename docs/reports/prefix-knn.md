# Prefix k-NN: early, stateless recognition of partial sketches with a nearest-neighbour baseline

Kami team, HackMIT 2026 — preliminary report, 2026-09-19

## Abstract

In the whiteboard game Kami, ink becomes a physical object once named, and the game tries to name a
drawing while the pen still moves. We describe its fallback recogniser: a training-free cosine
k-nearest-neighbour classifier over blurred 24×24 rasters of Quick, Draw! sketches. To read partial
sketches statelessly, each of 12,600 reference drawings (42 categories × 300) is indexed at 20, 35, 65 and
100% of its points, every prefix re-fitted to its own bounding box (50,206 rows). On 2,100 held-out
drawings, finished sketches reach 65.1% top-1 and 82.9% top-3 at 4.8 ms per query; live top-1 rises from
18.0% at 20% of the ink to 62.0% at 100%, at 19 ms. A silence policy states a live guess only when the
leading vote share reaches 0.6; it then speaks in 21.6% of live trials, 79.6% of them correctly. The vote
share is not a calibrated probability. Results are preliminary.

## 1 Introduction

In Kami (`docs/spec.md`) the player draws on an endless whiteboard and says what the drawing is; the named
thing then behaves accordingly in a physics simulation. When the player stays silent the game offers up to
three guesses, ideally before the drawing is finished. The route `POST /api/recognize` is stateless by
design (`server/README.md`, "API contract"): the client posts all strokes so far about every 150 ms with
`partial: true`, and once more without the flag when the drawing is done. The recogniser must therefore
read a prefix with no memory of earlier requests, answer well inside the polling interval on a CPU, and
stay quiet when unsure: Kami takes most of a second to handwrite a guess.

The intended recogniser is "Kami's Eye", a ResNet-18 [5] trained on prefixes (Section 7). The k-NN exists
beside it for two reasons. It needed no training: ingesting 300 drawings per category takes about 25 s and
no GPU (`server/README.md`). And it is always available: it runs inside the server process, and
`server/recognition/chain.ts` uses it alone when no sidecar is configured and as the floor whenever the
sidecar fails or does not answer within 150 ms (partial) or 400 ms (finished). The data are Quick, Draw! stroke
sequences [1]; unlike sequence models such as Sketch-RNN [2], we discard order once the prefix is cut and
classify a raster by the nearest-neighbour rule [3].

## 2 Method

```
INDEXING, once per reference drawing            QUERY, ~every 150 ms while drawing, once when finished

strokes (Quick, Draw! simplified)               strokes so far (world px, any scale or position)
   | first 20/35/65/100% of the points,            | computeFeature, fitted to own bounding box
   v   in drawing order                            v
each prefix re-fitted to ITS OWN bounding box   unit vector q (576-d)
   | computeFeature: 24x24 raster, blur, L2        |
   v                                               v
rows: [ whole drawings | prefixes ]  <-- dot -- finished: whole-drawing rows only
(one flat Float32Array)                         partial:  every row
                                                   | k = 15 nearest, weight = similarity^8
                                                   v
                              best similarity < 0.35 -> no answer; else vote share per category
                                                   |
                 partial and leader share < 0.6 -> silence; else up to 3 guesses with share >= 0.08
```

**Feature** (`server/quickdraw/feature.ts`). Empty strokes are dropped; no ink gives the zero vector. The
bounding box of all points is scaled by its longer side to 20 cells (a 24×24 grid less a 1.5-cell margin
per side), aspect kept, centred. Each segment is sampled at steps of at most 0.5 cell; each sample is
splatted bilinearly into its four surrounding cells, a cell keeping the *maximum* weight it receives, so
retraced ink does not count twice. The grid is blurred once with the kernel [0.25, 0.5, 0.25] along each
axis (a 3×3 binomial, zero outside the grid) and L2-normalised. The result is a non-negative unit vector
of length 576, so a dot product is a cosine similarity in [0, 1]. Reference drawings (0–255 coordinates)
and player ink (world pixels) pass through the same code, making the feature invariant to position and
scale.

**Prefixes** (`server/quickdraw/prefix.ts`, `prefixFeatures.ts`). For *n* points and a share *f*,
`prefixOfStrokes` keeps the first min(*n*, max(1, round(*f*·*n*))) points in drawing order across strokes,
keeps stroke boundaries and cuts the stroke under the pen short. The indexed shares are
`PREFIX_FRACTIONS` = 0.2, 0.35, 0.65, 1: shares of the point count, not of time or arc length. Each prefix
is fitted to its own bounding box, as a half-drawn sketch arrives from a player. Shares that cut a short
drawing at the same point count are stored once, under the larger share, so no sketch votes twice with the
same picture; a two-point line is stored at 0.65 and 1 only (`prefix.test.ts`).

**Index** (`corpusIndex.ts`, `featureMatrix.ts`). When this report was written MongoDB held one document
per drawing with its prefix features, copied at start-up into one flat `Float32Array`, whole-drawing rows
first, prefix rows after. Today the drawings are a read-only corpus file and the same rows, in the same
order, are a sparse matrix computed from it and cached on disk; the rankings are bit for bit the same
([server/README.md](../../server/README.md#quick-draw)).

**Queries and voting** (`server/quickdraw/recognizer.ts`). A *finished* query is compared with the
whole-drawing rows only, a *partial* query with every row, by a brute-force scan keeping the k = 15 most
similar rows. If the best similarity is below the similarity floor 0.35 the answer is empty. Otherwise
each neighbour votes for its category with weight similarity⁸, and a category's *confidence* is its share
of the vote. Up to three categories with a share of at least 0.08 (the confidence floor) are returned.

**Silence policy.** A partial query is answered only if the leader's share is at least 0.6
(`partialLeaderFloor`). Few points is never by itself a reason to refuse; an empty answer means "nothing
to say yet" and the client keeps its last guess. The route then folds game-equivalent categories, summing
their confidence ("birthday cake" into "cake").

## 3 Experimental setup

All numbers come from `server/quickdraw/evaluate.ts` as recorded in `server/README.md` ("Measured
accuracy") and in the implementing agent's two retained raw outputs (`evaluate-run1.txt`,
`evaluate-run2.txt`). Nothing was re-run for this report.

*Reference set.* The 42 categories of `server/quickdraw/categories.ts`; per category the first 300
`recognized: true` drawings in the first 1.5 MB of the public simplified ndjson: 12,600 drawings, 50,206
rows (194 fewer than 4 × 12,600, the merged duplicate cuts). *Held-out set.* Per category, the next 50
recognised drawings of the same file not in the index: 2,100. In the cached copy (`holdout.json`) the
median drawing has 30 points in 3 strokes (10th–90th percentile 14–59 points), so 20% of it is 6 points
(descriptive statistic computed for this report).

*Trials* (`server/quickdraw/evaluation.ts`). Each drawing is shown six ways: its first 20, 40, 60, 80 and
100% of points as partial queries, and whole as a finished query: 12,600 trials, 10,500 live. *Metrics.*
Top-1/top-3: the true category is first/among the stated guesses, with both floors and the limit of three
applied but the silence policy ignored. *Speaks*: share of trials the silence policy lets out; *right when
it speaks*: top-1 among those. *Per query*: mean wall time of `score()` (feature, scan, vote; no HTTP),
single-threaded under Bun on an Apple M4 laptop with other work running. Labels are scored raw, without
alias folding.

*Index designs.* (a) whole drawings only; (b) shares 35/65/100%; (c) shares 20/35/65/100% (current). Raw
outputs exist for (b) and (c); (a) is reported in `server/README.md` only. Tuning experiments used every
third held-out sketch (700).

## 4 Results

**Table 1.** Current design (c); 2,100 held-out sketches per row (`evaluate-run2.txt`).

| Ink shown | Top-1 | Top-3 | Speaks (leader ≥ 0.6) | Right when it speaks | Conf. ≥ 0.8: how often / right | Per query |
|---|---|---|---|---|---|---|
| 20%, live | 18.0% | 38.1% | 6.2% | 30.8% | 1.6% / 48.5% | 19.1 ms |
| 40%, live | 32.7% | 57.9% | 13.0% | 59.0% | 3.6% / 66.7% | 19.0 ms |
| 60%, live | 47.3% | 69.0% | 23.0% | 81.5% | 8.1% / 91.8% | 19.1 ms |
| 80%, live | 58.2% | 78.6% | 30.4% | 85.9% | 13.0% / 95.2% | 19.0 ms |
| 100%, live | 62.0% | 81.0% | 35.4% | 89.0% | 15.0% / 98.1% | 19.0 ms |
| 100%, finished | 65.1% | 82.9% | 100.0% | 65.1% | 25.3% / 95.5% | 4.8 ms |

**Table 2.** Sweep of the silence floor over the 10,500 live trials of Table 1.

| Leader share ≥ | 0.3 | 0.4 | 0.5 | **0.6** | 0.7 | 0.8 | 0.9 | 1.0 |
|---|---|---|---|---|---|---|---|---|
| Speaks | 70.9% | 49.0% | 32.4% | **21.6%** | 13.8% | 8.3% | 3.1% | 1.2% |
| Right when it speaks | 53.4% | 63.6% | 72.7% | **79.6%** | 86.3% | 91.4% | 94.5% | 95.9% |

**Table 3.** Index designs: top-1 / top-3 (%) by ink shown. "100% live" searches every row, "finished"
whole-drawing rows only. The last three columns are from `evaluate-run1.txt` and `evaluate-run2.txt`.

| Indexed shares | Rows | 20% | 40% | 60% | 80% | 100% live | Finished | ms, live / finished | Conf. ≥ 0.8 at 20% ink: how often / right | Speaks at 72.7% precision |
|---|---|---|---|---|---|---|---|---|---|---|
| (a) 100 † | 12,600 | 5.4 / 13.1 | 18.5 / 32.4 | 37.3 / 57.7 | 58.0 / 78.1 | 65.1 / 82.9 | 65.1 / 82.9 | not recorded | not recorded | — |
| (b) 35, 65, 100 | 37,775 | 14.5 / 30.8 | 35.0 / 60.4 | 49.5 / 71.4 | 60.5 / 80.4 | 63.3 / 81.7 | 65.1 / 82.9 | 14.5 / 4.9 | 4.7% / 17.3% | 27.7% (floor 0.6) |
| (c) 20, 35, 65, 100 | 50,206 | 18.0 / 38.1 | 32.7 / 57.9 | 47.3 / 69.0 | 58.2 / 78.6 | 62.0 / 81.0 | 65.1 / 82.9 | 19.0 / 4.8 | 1.6% / 48.5% | 32.4% (floor 0.5) |

† From `server/README.md` ("measured before this change"); raw output not retained.

*Per category, finished (n = 50 each; top-1 / top-3).* Best: line 92 / 96, door 88 / 98, fence 88 / 92,
circle 86 / 90, stairs and triangle 82 / 88. Worst: zigzag 20 / 40, bird 22 / 32, birthday cake 44 / 74,
rabbit 46 / 76, sun 48 / 76. *Footprint* (`server/README.md`): the rows occupy 116 MB and load in 0.3 s,
the process peaking near 0.6 GB; re-indexing the 12,600 stored drawings takes 6 s.

**Table 4.** Reliability of the leader's vote share for live queries, by ink shown (*n* / share right).
Secondary analysis for this report of the retained per-trial file `reads.json`, written by the tuning
script `progress.ts`: 700-sketch subsample × five ink levels = 3,500 reads, design (c), every row
searched, k = 15, exponent 8, a re-implementation of the vote without the similarity floor.

| Leader share | 20–40% ink | 60–100% ink | Pooled |
|---|---|---|---|
| < 0.4 | 945 / 20.2% | 789 / 33.0% | 1,734 / 26.0% |
| 0.4–0.6 | 319 / 38.2% | 653 / 57.0% | 972 / 50.8% |
| 0.6–0.8 | 95 / 40.0% | 391 / 79.5% | 486 / 71.8% |
| ≥ 0.8 | 41 / 61.0% | 267 / 92.9% | 308 / 88.6% |

## 5 Analysis

Section 4 holds the measurements; this section interprets them.

**Where it speaks.** Mostly late: in 6.2% of trials at 20% ink and 35.4% at 100%, precision rising from
30.8% to 89.0%; from 60% ink on, at least 81.5% of stated guesses are right. The floor is a plain trade
between coverage and precision (Table 2); 0.6 was chosen by judgement (a live guess "has to be worth
writing", `server/README.md`), not against a stated objective.

**Where it is wrong.** Early, and on categories drawn in many ways. `server/README.md` records that with
design (b), on the 700-sketch subsample, 17 of the 28 confident (≥ 0.8) wrong answers at 20% ink were
"line": a first stroke, re-fitted to its own bounding box, looks like a finished line. Zigzag and bird are
poor even when finished; we attribute this to a raster match tolerating little variation in pose and
style. Cake and birthday cake take each other's votes; the route folds the two, so the error a player sees
should be lower (not measured).

**Why the 20% share was added.** With design (b), a share ≥ 0.8 at 20% ink occurred in 4.7% of trials and
was right 17.3% of the time; with the 20% rows it occurs in 1.6% and is right 48.5%. Our reading: the 20%
rows show the index a first stroke in every category, so an early query draws neighbours from several
categories, the vote splits, and the silence policy holds. They also raise accuracy at 20%
ink (top-1 14.5 → 18.0, top-3 30.8 → 38.1) and, at an equal precision of 72.7%, coverage from 27.7% to
32.4% of live trials. The cost is about two points of live top-1 from 40% ink on (35.0 → 32.7, 49.5 → 47.3,
60.5 → 58.2, 63.3 → 62.0), a third more rows, and 14.5 → 19.0 ms per live query. The README also records
that k = 30, a vote exponent of 16, and gating on how finished the neighbours were did not improve the
trade on the subsample; their printed outputs were not retained (only the per-trial reads behind Table 4).

**Why finished queries search whole-drawing rows only.** "100% live" and "finished" show the same ink to
different row sets. Letting prefix rows compete costs a finished drawing 3.1 points of top-1 and 1.9 of
top-3 in design (c) (1.8 and 1.2 in (b)), at four times the latency (three times in (b)). We interpret the prefix rows as
distractors: half-drawn sketches of different categories resemble one another and, sometimes, a finished
drawing. The client knows whether the pen is down, so the `partial` flag costs nothing, and finished
accuracy stays where it was before prefixes were indexed.

**Vote share is not a calibrated probability.** It is the similarity-weighted share of 15 neighbours and
does not know how much of the drawing it sees. A share ≥ 0.8 is right 48.5% of the time at 20% ink and
98.1% at 100% (Table 1). In Table 4 the pooled share happens to track accuracy (mean share 0.69, 71.8%
right; 0.89, 88.6%), but only under the evaluation's uniform mix of ink levels: conditioned on progress,
which the recogniser does not observe, a share of 0.6–0.8 is right 40.0% of the time early and 79.5% late.
No calibration map in the sense of Guo et al. [4] has been fitted; a cautious client can only raise its
own threshold.

## 6 Limitations and threats to validity

- **Small, closed vocabulary**: 42 categories × 300 references. The README records that 600 per category
  bought about two points for twice the memory and query time; larger vocabularies were not measured.
- **Held-out set from the same distribution**: the next entries of the same file heads, all already
  recognised by Google's classifier, in the dataset's simplified point format. No player ink was evaluated.
- **Point-count prefixes only.** A player's points arrive by time, while simplified dataset points
  cluster at corners, so "20% of the points" is a different moment in the two settings. Time- or
  arc-length-based prefixes were not evaluated. Two of the five ink levels (20%, 100%) coincide with
  indexed shares, which may favour them.
- **Sampling error; tuning on the test data.** The binomial standard error is about 1 point overall
  (n = 2,100) and 7 points per category (n = 50). Two-point differences between designs are paired but
  untested. Floors, k, exponent and shares were chosen on this same held-out set.
- **Latency**: mean of the in-process scan on a busy laptop, one run, no percentiles, HTTP excluded; not
  measured on the GX10, where the game runs. Brute-force time grows linearly with rows.
- **Confidence not calibrated** (Section 5); Table 4 rests on a subsample, a re-implemented vote and cells
  as small as 41 reads.
- **Provenance.** Design (a), the subsample findings and the footprint figures survive only as statements
  in `server/README.md`. An earlier exploratory script in the scratch directory cut prefixes by arc
  length; we could not confirm which protocol produced row (a) of Table 3.

## 7 Relation to the trained model and future work

`ml/CONTRACT.md` specifies Kami's Eye: a ResNet-18 [5] over a 64×64 rendering, trained with half of all
samples as random prefixes (30–100% of the points, in drawing order), each rendered in its own bounding
box as here, so one stateless model reads finished and half-drawn sketches alike; its probabilities are
temperature-scaled [4] on held-out data. The server asks the model's sidecar first and falls back to this
k-NN on timeout, error or when unset.

A first one-epoch *timing* run on the GX10 (345 categories × 1,500 drawings, 50% prefixes; recorded on the
box in `~/kami-ml/logs/timing.log` and `~/kami-ml/artifacts/timing/preprocess.json`, not in the repository)
gave, on its own test split (n = 25,639), top-1 / top-3 of 63.9 / 82.8% on finished drawings (n = 12,775)
and 16.1 / 33.1% on 30–50% prefixes (n = 3,666). **This is a one-epoch throwaway run over 345 classes and
is not comparable like-for-like with the 42-class k-NN**: the label space is about eight times larger;
test drawings, prefix definition and buckets differ; and the run was made to measure throughput. No
completed full training run is recorded in the sources consulted.

Future work: (1) evaluate both recognisers on one 42-class held-out set through the same route, alias
folding included; (2) collect real player ink and evaluate time-based prefixes; (3) fit a calibration map
for the vote share, possibly conditioned on estimated progress; (4) measure latency on the GX10; (5) try
nearest neighbours over the model's 512-d embedding, which the sidecar contract already exposes
(`POST /embed`).

## References

[1] J. Jongejans, H. Rowley, T. Kawashima, J. Kim, N. Fox-Gieg. *The Quick, Draw! A.I. Experiment.*
Google, 2016. Dataset: https://github.com/googlecreativelab/quickdraw-dataset

[2] D. Ha, D. Eck. A Neural Representation of Sketch Drawings. *ICLR*, 2018. arXiv:1704.03477.

[3] T. M. Cover, P. E. Hart. Nearest Neighbor Pattern Classification. *IEEE Transactions on Information
Theory*, 13(1):21–27, 1967.

[4] C. Guo, G. Pleiss, Y. Sun, K. Q. Weinberger. On Calibration of Modern Neural Networks. *ICML*, 2017.

[5] K. He, X. Zhang, S. Ren, J. Sun. Deep Residual Learning for Image Recognition. *CVPR*, 2016.
