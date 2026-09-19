# Kami's Eye — training kit and sidecar

One ResNet-18 that reads a 64×64 rendering of a sketch, finished or half-drawn, and names it.
`CONTRACT.md` is the agreement with the rest of Kami (tensor, artefact files, sidecar routes); this
directory is the Python that honours it. Nothing here touches the game: the Bun server reaches the
model through the sidecar and falls back to its k-NN when the sidecar is not there.

## The real run (you have a GPU — this part is for you)

Needs [uv](https://docs.astral.sh/uv/), internet, and disk for the rendered dataset (sizes below).

```sh
cd ml
uv sync --group train                       # Python 3.12 + torch into ml/.venv, nothing system-wide
uv run --group train python -c "import torch; print(torch.cuda.is_available())"   # must print True
uv run --group train python train.py --all --samples-per-class 8000 --epochs 8 --name kami-eye
```

`train.py` downloads the head of each category's `.bin`, renders it once into a memmap, trains
(AdamW + OneCycle, AMP on CUDA, label smoothing 0.1, small affine augmentation), prints top-1/top-3
on validation overall **and by prefix bucket**, fits the temperature, reports the test split, and
writes `artifacts/kami-eye/`. It prints `img/s` after every epoch. Re-running with the same
arguments reuses the download and the rendered dataset.

Pick a row. **The times are estimates**, not measurements: this Mac (M4, MPS) measured 353 img/s,
and I assume a modern CUDA card with AMP does about 8 000 img/s on this network (ResNet-18 at
roughly a third of its ImageNet FLOPs). Check the `img/s` of your first epoch and scale
`--samples-per-class` by `your img/s ÷ 8000`; about 12 minutes of each budget is download, render,
validation and export.

| Budget | Categories | Command arguments | Train passes | Dataset on disk | Download |
|---|---|---|---|---|---|
| ~1 h | all 345 | `--all --samples-per-class 8000 --epochs 8` | 19.9 M | 11 GB | 0.7 GB |
| ~1 h | curated 113 | `--categories categories/curated.txt --samples-per-class 25000 --epochs 8` | 20.3 M | 12 GB | 0.8 GB |
| ~3 h | all 345 | `--all --samples-per-class 22000 --epochs 10` | 68 M | 31 GB | 2.1 GB |
| ~3 h | curated 113 | `--categories categories/curated.txt --samples-per-class 70000 --epochs 10` | 71 M | 32 GB | 2.0 GB |

All 345 is the default choice: `server/natures/` already has a nature for every category, so every
class the model can name is playable. The curated list (`categories/curated.txt`: the 42 categories
the k-NN knows plus 71 distinct physical objects and shapes) trades vocabulary for accuracy and is
the better pick if only an hour is available. Use a different `--name` per run.

Other switches: `--batch-size 512` (1024 is fine on a big card), `--learning-rate 2e-3`,
`--thickness-jitter 1` (± px on training renders only, a build-time option), `--prefix-share 0.5`,
`--megabytes-per-class N` (default is 250 B per requested drawing; a category that comes up short is
reported and trained with what it has), `--device cuda|mps|cpu`, `--download-only`.

No internet on the GPU machine (the GX10)? Run the same command with `--download-only` on a machine
that has it, copy `ml/data/bin/` across, and run without the flag: fetched categories are skipped.
The Python environment has to get there too (`uv sync` needs an index or a wheel cache). If
`torch.cuda.is_available()` is `False` on a CUDA machine, install the torch build for its CUDA
version from pytorch.org's selector into `ml/.venv` with `uv pip install`.

**Not exercised here:** the CUDA/AMP branch (no CUDA device on this Mac). MPS and CPU both ran end
to end.

### What to hand back

The directory `ml/artifacts/<name>/` (it is gitignored — zip it or copy it):

| File | |
|---|---|
| `model.onnx` | opset 17, input `image` `[N,1,64,64]`, outputs `logits` `[N,K]` and `embedding` `[N,512]`, 45 MB |
| `labels.json` | category names, index = logit index |
| `preprocess.json` | the contract's fields (`temperature`, `renderSha256`, `top1`/`top3` = test split overall) plus `validation` and `test` tables by prefix bucket |
| `golden.json` | 50 held-out cases for parity tests |
| `model.pt` | the PyTorch weights, only needed to re-export |

Also paste the printed validation/test tables into the chat — they are the live-guessing curve.

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

## Measured on this Mac — a smoke test, not the real model

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
uv run --group train pytest     # 49 tests: render, .bin round trip, dataset, sidecar routes on a
                                # tiny real ONNX model, model/export/calibration, golden parity
uv run ruff check . && uv run ruff format --check . && uv run mypy .
```

Without `--group train` the torch-dependent tests skip themselves.
