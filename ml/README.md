# Kami's Eye — training kit and sidecar

One ResNet-18 that reads a 64×64 rendering of a sketch, finished or half-drawn, and names it.
`CONTRACT.md` is the agreement with the rest of Kami (tensor, artefact files, sidecar routes); this
directory is the Python that honours it. Nothing here touches the game: the Bun server reaches the
model through the sidecar and falls back to its k-NN when the sidecar is not there.

## The real run — on the GX10

All training happens on the box (`ssh gx10`), in `~/kami-ml`. Its environment is a `uv` venv with the CUDA 13
build of torch for the GB10 (`~/kami-ml/setup-env.sh` made it; `uv sync` would replace that torch with the
index default, so call the venv's Python directly):

```sh
rsync -az --delete --exclude .venv --exclude data --exclude artifacts --exclude '__pycache__' \
  --exclude setup-env.sh --exclude logs ml/ gx10:kami-ml/          # from the repo root, on the Mac
ssh gx10
cd ~/kami-ml && .venv/bin/python -m pytest -q
setsid nohup .venv/bin/python train.py --all --samples-per-class 8000 --epochs 8 --batch-size 1024 \
  --name kami-eye > logs/kami-eye.log 2>&1 < /dev/null &
~/kami/box/start.sh        # when it has finished: the game now answers with the new model
```

`train.py` downloads the head of each category's `.bin`, renders it once into a memmap, trains
(AdamW + OneCycle, AMP on CUDA, label smoothing 0.1, small affine augmentation), prints top-1/top-3
on validation overall **and by prefix bucket**, fits the temperature, reports the test split, and
writes `artifacts/<name>/`. It prints `img/s` after every epoch. Re-running with the same
arguments reuses the download and the rendered dataset. `box/start.sh` serves `artifacts/kami-eye`;
use another `--name` for experiments.

**Measured on the GB10** (batch 1024, AMP, GPU at 96 %): **6 800 img/s**, so an epoch over 2.5 M
drawings takes 5 min 50 s. Downloading all 345 categories at 5.5 MB each (2.0 GB) took 3 min 20 s on the
venue Wi-Fi; rendering 2.76 M drawings on 20 cores took 19 s.

| Budget | Categories | Command arguments | Train passes | Dataset on disk | Download |
|---|---|---|---|---|---|
| ~50 min | all 345 | `--all --samples-per-class 8000 --epochs 8` | 19.9 M | 11 GB | 0.7 GB |
| ~50 min | curated 113 | `--categories categories/curated.txt --samples-per-class 25000 --epochs 8` | 20.3 M | 12 GB | 0.8 GB |
| ~2 h 50 | all 345 | `--all --samples-per-class 22000 --epochs 10` | 68 M | 31 GB | 2.1 GB |
| ~2 h 55 | curated 113 | `--categories categories/curated.txt --samples-per-class 70000 --epochs 10` | 71 M | 32 GB | 2.0 GB |

All 345 is the default choice: `server/natures/` already has a nature for every category, so every
class the model can name is playable. The curated list (`categories/curated.txt`: the 42 categories
the k-NN knows plus 71 distinct physical objects and shapes) trades vocabulary for accuracy.

Other switches: `--batch-size 512` (1024 is fine on a big card), `--learning-rate 2e-3`,
`--thickness-jitter 1` (± px on training renders only, a build-time option), `--prefix-share 0.5`,
`--megabytes-per-class N` (default is 250 B per requested drawing; a category that comes up short is
reported and trained with what it has), `--device cuda|mps|cpu`, `--download-only`.

### What a run leaves behind

The directory `artifacts/<name>/` (gitignored; it stays on the box, where the sidecar reads it):

| File | |
|---|---|
| `model.onnx` | opset 17, input `image` `[N,1,64,64]`, outputs `logits` `[N,K]` and `embedding` `[N,512]`, 45 MB |
| `labels.json` | category names, index = logit index |
| `preprocess.json` | the contract's fields (`temperature`, `renderSha256`, `top1`/`top3` = test split overall) plus `validation` and `test` tables by prefix bucket |
| `golden.json` | 50 held-out cases for parity tests |
| `model.pt` | the PyTorch weights, only needed to re-export |

The printed validation/test tables by prefix bucket are the live-guessing curve; they are also kept in
`preprocess.json`.

## Try a model locally

```sh
cd ml
KAMI_EYE_MODEL=artifacts/kami-eye uv run --no-dev python sidecar.py      # 127.0.0.1:8790
curl -s localhost:8790/health
curl -s localhost:8790/recognize -d '{"strokes":[[{"x":0,"y":0},{"x":90,"y":0},{"x":90,"y":90},{"x":0,"y":90},{"x":0,"y":0}]],"top":3}'
KAMI_EYE_MODEL=artifacts/kami-eye uv run pytest tests/test_golden.py      # renders + top-3 match the export
```

Then start the game's server with `KAMI_RECOGNIZER_URL=http://127.0.0.1:8790`. The sidecar needs
only `numpy`, `opencv-python-headless` and `onnxruntime` (`uv sync --no-dev`); it never imports
torch. `KAMI_EYE_PORT` changes the port; `KAMI_EYE_MODEL` defaults to `artifacts/kami-eye`.

Sidecar behaviour beyond the contract's table: `partial` is validated and otherwise ignored (the one
model reads prefixes and finished drawings alike); `top` is 1–1000 and capped at K; a drawing with
no points, non-finite or absurd (> 1e9) coordinates, more than 50 000 points, a body over 4 MB or
anything that is not the documented JSON is `400 {"error"}`; unknown routes are `404 {"error"}`; an
unexpected exception is `500 {"error"}` and the process keeps serving. `/health` additionally
reports `renderMatches` — whether `render.py` still has the sha256 the model was trained with.
One log line per request: `POST /recognize 200 5.3 ms`.

## Kami finishes your drawing — exemplars and `/complete`

`POST /complete` answers a rough sketch (and, optionally, the name the player gave it) with a clean
human drawing of the same thing from Quick, Draw!, the one whose embedding is closest to the
player's, scaled and centred onto their ink. The rules are in `CONTRACT.md` → Completion. It needs an
exemplar set next to the model, built once per trained model, **on the box** (it embeds half a
million drawings; ONNX Runtime on the CPU, no torch, no GPU), after the `rsync` above has put this
directory's code in `~/kami-ml`:

```sh
ssh gx10
cd ~/kami-ml
setsid nohup nice -n 10 .venv/bin/python exemplars.py --model artifacts/kami-eye \
  --min-probability 0.7 > logs/exemplars.log 2>&1 < /dev/null & disown      # ~26 min; tail the log
~/kami/box/start.sh          # the sidecar loads artifacts/kami-eye/exemplars/, and the Kami server
                             # gets KAMI_BEAUTIFY_URL=http://127.0.0.1:8790/complete
curl -s localhost:8790/health                                  # … "exemplars": N (up to 345 × 200)
curl -s localhost:8790/complete -d '{"name":"a square","strokes":[[{"x":0,"y":0},{"x":90,"y":5},{"x":85,"y":90},{"x":0,"y":80},{"x":0,"y":0}]]}'
```

Switches: `--per-class 200`, `--candidates-per-class 1500` (the head of each `.bin`),
`--min-probability 0.9`, `--threads 6` (ONNX Runtime; keep it modest while something trains),
`--data-dir data` (holds `bin/`). The build prints progress every 25 categories and ends with a
summary: exemplars kept, categories that came up short (reported, never fatal — a weak model is
sure of fewer drawings), candidates per second, size on disk and load time. The same model, data and
arguments write byte-identical files.

`--min-probability` only decides categories that come up short: a category with 200 drawings above
0.9 keeps the same 200 at any lower bar, because they are ranked by probability. The real `kami-eye`
(8 epochs, 81 % top-1 on finished drawings) is rarely 0.9 sure of the plainest shapes, which look
like many things: at 0.9 it keeps 2 of 1500 circles and 9 squares (bird 166; cloud, dog, cat, house,
star, car, line, triangle 200); at 0.7 circle, square and bird are full too. Hence 0.7 above; the
default stays the contract's 0.9.

**Retrain the model and the set is stale**: the sidecar notices (`modelSha256`), warns, and serves
without `/complete` until `exemplars.py` has run again.

Without an exemplar set `/complete` is `404`, `/health` says `"exemplars": 0`, and the game keeps the
player's own ink (`/api/beautify` → `501`).

**Measured on the GB10** with `artifacts/timing` (345 classes, one epoch, 52 % top-1 — weak but
real), CPU only, `--threads 6`, `nice -n 10`, while a training run and another job had the box:

| | |
|---|---|
| Build | 517 500 candidates in 1 552 s — 333 drawings/s (4.3 s per category when the six threads are not contended) |
| Kept | 44 477 exemplars: 163 categories full (200), 182 short, 35 of those empty (circle, square, cloud, dog, … — a one-epoch model is never 0.9 sure of them); median 174 per category, 4 strokes and 36 points per exemplar |
| On disk | 50.7 MB: embeddings 45.5 MB, 1.76 M points 3.5 MB, offsets 1.0 MB, the rest 0.6 MB |
| Load | 4 ms for the arrays; 26 ms at sidecar start with the sha256 of `model.onnx`; the sidecar's RSS is 179 MB with them |
| Determinism | two builds with equal arguments in different directories: every file byte-identical |

`POST /complete` on a quiet box, keep-alive, 25 held-out drawings (test split, beyond the first 8000
of their `.bin`, never exemplars) from 25 categories, each posted four ways in world px (×2.5, offset):

| Request (n = 25 each) | p50 | p95 | 200 | right category |
|---|---|---|---|---|
| finished | 8.8 ms | 16.8 ms | 15 | 14 |
| finished, `name` | 8.8 ms | 12.9 ms | 23 | 23 |
| first half of the points | 6.9 ms | 13.8 ms | 3 | 2 |
| first half of the points, `name` | 9.3 ms | 15.5 ms | 23 | 23 |
| all 100 | 8.8 ms | 16.1 ms | 64 | all 64 answers inside the request's bounds (measured before the morph: the answer was then the placed exemplar) |

The 404s are this model, not the route: without a name a one-epoch model is rarely 0.5 sure, least
of all of half a drawing, and two of the 25 categories had no exemplars. Example answers — finished
banana, no name: banana 0.78, similarity 0.97, 2 strokes / 30 points in, 4 strokes / 26 points out,
bounds (4000, −700)–(4342.5, −62.5) in, (4013.8, −700)–(4328.8, −62.5) out; half a calculator named
"a calculator": confidence 0.36, similarity 0.89, 3 strokes / 26 points, full height, centred in the
width; half a sailboat named: confidence 0.02 (the model sees something else in two strokes; the
name decides), similarity 0.70, a whole sailboat inside the half's box.

**The real model**, `artifacts/kami-eye` (8 epochs, 81 % top-1 finished), `--min-probability 0.7`, on
a quiet box: 517 500 candidates in 1 054 s (491 drawings/s); **68 971 exemplars, 342 of 345
categories full** (garden hose 191, hurricane 199, marker 181); 79.0 MB (embeddings 70.6 MB, 2.89 M
points 5.8 MB); arrays load in 5 ms, 28 ms at sidecar start; sidecar RSS 207 MB. The same 100
requests (their own 25 held-out drawings):

| Request (n = 25 each) | p50 | p95 | 200 | right category |
|---|---|---|---|---|
| finished | 10.0 ms | 22.2 ms | 24 | 24 |
| finished, `name` | 10.1 ms | 17.7 ms | 25 | 25 |
| first half of the points | 9.8 ms | 18.2 ms | 17 | 11 |
| first half of the points, `name` | 11.0 ms | 19.8 ms | 25 | 25 |
| all 100 | 10.1 ms | 20.4 ms | 91 | all 91 answers inside the request's bounds (measured before the morph) |

Finished envelope, no name: envelope 0.95, similarity 0.97, 1 stroke / 24 points in, 1 stroke / 25
points out. Half a bracelet named "a bracelet": confidence 0.55, similarity 0.76, 2 strokes in, a
whole 5-stroke bracelet out, full width, centred in the height. A hand-made five-point square named
"a square": a human's one-stroke square, similarity 0.97. Half a panda without a name came back as
a cat (0.80): with no name a wrong guess is a clean drawing of the wrong thing, which is why the
game sends the name.

The handler now sets `TCP_NODELAY`: the stdlib server writes headers and body separately, and on Linux
a keep-alive client otherwise sits out the 40 ms delayed ACK on every request — `/recognize` on the
box went from p50 51 ms to p50 3.6 ms, p95 6.3 ms (n = 60, keep-alive).

## The first smoke test (on a Mac, before the box was reachable) — not the real model

`uv run --group train python train.py --categories categories/smoke.txt --samples-per-class 2500 --epochs 3 --name smoke`
— 8 categories (circle, line, square, triangle, star, mushroom, ladder, cloud), 20 000 drawings,
M4 on MPS while the machine was busy with other work (load average ~6). 2 min 43 s wall including
the 24 MB download, rendering and export; **353 img/s** training throughput (CPU: 48 img/s). It
proves the pipeline; eight easy classes say nothing about 345.

| Validation (n = 1018) | n | top-1 | top-3 |
|---|---|---|---|
| overall (half prefixes) | 1018 | 95.6 % | 99.3 % |
| prefix 30–50 % of points | 127 | 84.3 % | 97.6 % |
| prefix 50–70 % | 142 | 97.9 % | 100.0 % |
| prefix 70–90 % | 147 | 94.6 % | 98.6 % |
| prefix 90–100 % | 84 | 95.2 % | 100.0 % |
| finished drawings | 518 | 98.1 % | 99.6 % |

Test split (n = 1017): 94.5 % / 99.0 % overall, 73.6 % / 96.4 % on 30–50 % prefixes, 98.0 % / 99.6 %
finished. Temperature 0.583 (validation NLL 0.258 → 0.173; label smoothing leaves the raw model
under-confident). 49 of the 50 golden cases are right at top-1.

Sidecar, ONNX Runtime CPU, same machine, a held-out mushroom posted in "world px" (×2.5, offset):

| Request | p50 | p95 |
|---|---|---|
| `POST /recognize`, 24 points, keep-alive, n = 300 | 5.4 ms | 6.5 ms |
| `POST /recognize`, new connection each time, n = 100 | 6.1 ms | 7.1 ms |
| `POST /recognize`, one dense 1500-point stroke, n = 100 | 9.8 ms | 11.5 ms |
| `POST /embed`, n = 300 | 5.9 ms | 6.9 ms |

Warm-up at start: 10 ms. The 345-class model has the same backbone and a larger final `Linear`, so
expect the same latency. Example answers: finished mushroom → mushroom 0.997; the first half of its
points → mushroom 0.51, circle 0.26; half a ladder → ladder 0.99. The smoke artefact is left in
`artifacts/smoke/` and the sidecar was stopped afterwards.

## How it is put together

| File | |
|---|---|
| `render.py` | the contract's rasteriser, plus `take_prefix` / `render_prefix`, `from_xy_arrays`, `to_model_input`, `image_sha256` |
| `quickdraw_bin.py` | `.bin` parser and writer; range-fetches the first N MB per category into `data/bin/`, cut back to whole records, with a manifest so nothing is fetched twice |
| `dataset.py` | renders recognised drawings into `data/datasets/<name>/images.u8` (uint8 memmap) with labels, prefix fractions, splits and key_ids; one process per core |
| `batches.py`, `augment.py` | memmap → device batches on a read-ahead thread; per-image random affine on the device |
| `model.py` | `SketchNet`: torchvision `resnet18`, `forward -> (logits, embedding)` |
| `loop.py`, `metrics.py`, `calibrate.py` | the fit loop, bucketed top-1/top-3, temperature scaling |
| `export.py` | ONNX export and the four artefact files |
| `recognizer.py`, `sidecar.py` | artefact directory → recogniser; the stdlib HTTP server over it |
| `exemplars.py`, `exemplar_set.py` | the CLI that picks each category's prototypical drawings with a trained model; the file set they are kept in (ragged uint8 strokes + float16 embeddings) |
| `completion.py` | sketch + optional name → category → most similar exemplar → the morph |
| `morph.py` | the player's own strokes tidied toward the fitted exemplar (bounded, point for point), plus the parts that are missing |
| `train.py` | the CLI that runs all of the above |

- **Stem: 3×3 stride 2, no max-pool** (not stride 1): ink is ~1.5 px wide after the 256 → 64
  area-downsample, so one early stride loses little, and it is 4× cheaper than the CIFAR-style stem —
  which is what buys more data per GPU hour and ~5 ms CPU inference.
- **Fit**: points map to pixel centres 12 … 243 of the 256 canvas (span 231), rounded to whole
  pixels, so the picture is exactly centred and a mirrored sketch gives a mirrored image. Translation
  and power-of-two scaling reproduce the image bit for bit; other scales differ by rounding only.
- **Prefixes** keep the first ⌈fraction × points⌉ points in drawing order (at least one) and are
  fitted to their own bounds. They are rendered at dataset-build time: each drawing is a prefix with
  probability 0.5, fraction uniform in [0.3, 1.0), from a generator seeded by `(seed, label)`, so a
  rebuild is identical.
- **Split** by splitmix64 of `key_id`, modulo 100: < 90 train, < 95 validation, else test. A drawing
  never changes side between runs or dataset sizes.
- **`golden.json`** cases are test-split drawings spread evenly over the categories, every other one
  cut to a 35/50/65/80 % prefix. `strokes` is already the (possibly cut) input in the sidecar's
  request shape `[[{"x","y"},…],…]`; `imageSha256` is the sha256 of the 4096 row-major bytes of
  `render(strokes)`; `top3` comes from the exported ONNX through the sidecar's own code path.
  Additive fields: `probs`, `label` (the truth), `fraction`.
- `renderSha256` is the sha256 of `render.py`'s bytes — any edit to that file, even whitespace,
  marks older models as mismatched (`renderMatches: false`, a warning at start). That is the point.

## Checks

```sh
uv run --group train pytest     # 133 tests: render, .bin round trip, dataset, sidecar routes on a
                                # tiny real ONNX model, model/export/calibration, golden parity,
                                # exemplar files and selection, completion and placement, /complete
uv run ruff check . && uv run ruff format --check . && uv run mypy .
```

Without `--group train` the torch-dependent tests skip themselves.
