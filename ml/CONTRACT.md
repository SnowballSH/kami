# Kami's Eye — the contract between training, serving and the game

One small raster CNN recognises sketches, finished or half-drawn. Everything that must agree between
the person who trains it, the process that serves it and the Bun server lives here.

## The tensor

`image` — float32 `[N, 1, 64, 64]`, ink = 1.0 on background 0.0, no mean/std normalisation.

Produced by **one function**, `ml/render.py: render(strokes) -> uint8 [64, 64]`, used by training and
by serving, so they cannot drift:

1. `strokes` is a list of strokes, each a list of `(x, y)` in any units, any scale, any position, y-down.
2. Drop empty strokes. Fit the bounding box of all points, aspect preserved, centred, into a 256×256
   canvas with a 12 px margin. A drawing that is a single point becomes a dot in the centre.
3. Draw every stroke as an anti-aliased polyline, thickness 6, white on black (`cv2.polylines`,
   `LINE_AA`); single-point strokes as filled circles of radius 3.
4. Downsample to 64×64 with `cv2.INTER_AREA`. Return uint8; the model input is that / 255.

A **prefix** (a drawing still under the pen) is rendered exactly the same way — fitted to *its own*
bounding box. Training makes half of all samples random prefixes (30–100 % of the points, in drawing
order), which is what lets one stateless model guess while the pen is still moving.

## The files a trained model ships as (`ml/artifacts/<name>/`)

| File | |
|---|---|
| `model.onnx` | input `image` as above; outputs `logits` float32 `[N, K]` and `embedding` float32 `[N, 512]` (the pooled features, not normalised). Opset 17, dynamic batch. |
| `labels.json` | array of K Quick, Draw! category names; index = logit index |
| `preprocess.json` | `{ "size": 64, "canvas": 256, "margin": 12, "thickness": 6, "temperature": T, "renderSha256": "<sha of render.py>", "trainedOn": "...", "top1": x, "top3": y }` — `temperature` from temperature scaling on held-out data, so probabilities mean what they say |
| `golden.json` | ~50 `{ "strokes": [...], "imageSha256": "...", "top3": [...] }` cases for parity tests |
| `release.json` | version 1, `sha256` map of the four files above; its SHA-256 is the served `artifactId` |

Exports build a new immutable sibling release and atomically replace the model-name symlink only
after compatibility checks and golden generation succeed. Readers resolve the link once; previous
releases remain available. An existing ordinary directory is never overwritten: export under a new
name and select it with `KAMI_EYE_MODEL_NAME`. Legacy bundles require a reviewed re-export on GX10.
The sidecar rejects incomplete/corrupt bundles, renderer mismatches, invalid temperature, duplicate
or empty labels, and incompatible tensor types/shapes before listening. Its health adds `artifactId`
and `renderMatches: true`; incompatible models never report healthy.

## The sidecar (`ml/sidecar.py`, Python 3.12, ONNX Runtime CPU, stdlib HTTP)

Listens on `127.0.0.1:8790` (`KAMI_EYE_PORT`), loads `KAMI_EYE_MODEL` (an artifacts directory).

| Route | Request | Response |
|---|---|---|
| `GET /health` | | `{ "ok": true, "classes": K, "model": "<name>", "exemplars": N }` — `N` is 0 when the model has no exemplar set |
| `POST /recognize` | `{ "strokes": [[{"x":1,"y":2},...],...], "partial": false, "top": 5 }` | `{ "labels": [...], "probs": [...] }` — best first, temperature-scaled softmax, `top` entries (default 5) |
| `POST /embed` | `{ "strokes": ... }` | `{ "embedding": [512 floats, L2-normalised] }` |
| `POST /complete` | `{ "strokes": ..., "name": "a mushroom" }` (`name` optional) | `{ "tidied": [[{"x":..,"y":..},...],...], "added": [...], "category": "mushroom", "confidence": 0.93, "similarity": 0.81, "exemplar": "5152802093400064" }`, or `404 {"error"}` — see Completion |

Strokes arrive raw, in world px; the sidecar owns rendering. Bad input → `400 {"error"}`; never a crash.

## Completion — "Kami finishes your drawing"

Given a rough sketch, finished or half-drawn, and optionally the name the player gave it, the sidecar
answers with a clean human drawing of the same thing from Quick, Draw!, chosen to look like the
player's and placed where they drew. It is retrieval in the recogniser's own embedding space: no
second model, no training.

### The exemplar set (`ml/artifacts/<name>/exemplars/`)

Built once per trained model by `ml/exemplars.py`; the sidecar loads it at start when it is there.
`N` exemplars, sorted by label, so a category is one contiguous window; within a category, best first.

| File | |
|---|---|
| `embeddings.npy` | float16 `[N, 512]` — the model's `embedding` of the finished drawing, L2-normalised |
| `labels.npy` | int32 `[N]`, ascending — index into `labels.json` |
| `probabilities.npy` | float16 `[N]` — the calibrated probability the model gave the true category |
| `key_ids.npy` | uint64 `[N]` — the Quick, Draw! `key_id`, for provenance and for keeping test drawings apart |
| `points.npy` | uint8 `[P, 2]` — every point of every exemplar, `(x, y)` in Quick, Draw!'s 0–255 simplified space |
| `stroke_offsets.npy` | uint32 `[S + 1]` — stroke `s` is `points[stroke_offsets[s] : stroke_offsets[s + 1]]` |
| `drawing_offsets.npy` | uint32 `[N + 1]` — exemplar `i` is strokes `drawing_offsets[i] … drawing_offsets[i + 1] - 1` |
| `meta.json` | `{ "version": 1, "count": N, "categories": [...], "modelSha256", "renderSha256", "perClass", "candidatesPerClass", "minProbability", "typicalOctaves" }` |

Plain `.npy`, no pickle, no timestamps: the same model, data and arguments write the same bytes.
345 × 200 exemplars are about 80 MB on disk and in memory and load in well under a second.
`modelSha256` is the sha256 of `model.onnx`; a set built with another model is refused (its embeddings
belong to another space) and the sidecar then serves without `/complete`, with a warning.

### Which drawings become exemplars

For every label, the first `candidatesPerClass` (1500) drawings of `data/bin/<category>.bin` that
Quick, Draw! itself recognised and whose bounding box is not a single point. Each is rendered
finished by `render.py` and read by the model. A candidate is kept when

1. the model's top-1 is the true category with calibrated probability ≥ `minProbability` (0.9), and
2. it is typical: its stroke count and its point count are each within a factor of two
   (`typicalOctaves` = 1) of the category's medians over the candidates — no one-stroke scribble of a
   five-stroke thing, no forty-stroke shading.

The best `perClass` (200) are kept, ranked by probability, then by closeness to the medians, then by
`key_id`. A category that comes up short is reported by the build and simply has fewer exemplars (or
none); it is never an error.

### `POST /complete`

Same body limits, validation and logging as `/recognize`. `name` is optional, a string of at most 200
characters; `null` and `""` mean no name.

1. **Category.** The name — lower-cased, whitespace collapsed, a leading "a", "an" or "the" dropped
   (labels are compared the same way, so "eiffel tower" finds "The Eiffel Tower") — when it is one
   of the labels, or ends with one ("a bouncy mushroom" is a mushroom; the longest such ending
   wins). Otherwise the model's top-1 when its calibrated probability is ≥ 0.5.
   Otherwise no answer.
2. **Exemplar.** Among that category's exemplars, the highest
   `cosine(sketch, exemplar) + 0.05 × exemplar probability`.
3. **Morph** (`morph.py`) — the drawing stays the player's; nothing of theirs is replaced.
   - *Fit.* The exemplar is laid over the player's ink at one scale for both axes (never rotated):
     diagonals matched and centred, then the best of a small grid of scales and shifts, then a few
     rounds of scale-and-shift least squares on nearest points. What counts is the player's ink lying
     on the exemplar; the exemplar lying on their ink counts a tenth as much, so a half-drawn sketch
     gets a whole exemplar of the right size around it rather than one squeezed into its bounds.
   - *Tidy.* Every point of the player's moves toward the nearest point of the fitted exemplar:
     by `strength` (0.5) of the way, smoothed along the stroke so lines bend rather than jitter, never
     more than 6 % of the ink's bounding-box diagonal, and not at all when the exemplar has nothing
     within 12 % of it (ink the exemplar does not have is left alone).
   - *Add.* Runs of the fitted exemplar farther than 8 % of the diagonal from any of the player's ink,
     and at least 10 % of it long, become new strokes. A finished drawing usually gets none.

`200 { "tidied", "added", "category", "confidence", "similarity", "exemplar" }`. **`tidied` has exactly
the request's shape** — the same strokes in the same order, each with the same number of points — so a
client can tween point for point from the ink to it. `added` is the missing parts, to be drawn in; they
may lie outside the ink's bounds. Both are in the request's world space, rounded to 0.01 px.
`confidence` is the model's calibrated probability of `category` for the player's sketch (it can be low
when the name decided), `similarity` the cosine to the chosen exemplar, `exemplar` that drawing's
Quick, Draw! `key_id` as a string. `404 {"error"}` when the model has no exemplar set or there is no
answer: no known name and an unsure model, a category without exemplars, or ink with a zero-size
bounding box. The Bun server turns any non-200 into `501`, and the game keeps the player's own ink.

## The Bun server

`KAMI_RECOGNIZER_URL` (e.g. `http://127.0.0.1:8790`) selects the sidecar. `/api/recognize` asks it with a
short timeout; on timeout, error, or when unset it falls back to the built-in k-NN, so the client never
notices. Category names are merged through aliases ("birthday cake" → cake) and carry a physics nature
from the reviewed table in `server/natures/`. The public route's shape does not change except by addition.

`KAMI_BEAUTIFY_URL` set to the sidecar's `/complete` (e.g. `http://127.0.0.1:8790/complete`) makes
`POST /api/beautify` — which forwards `{ strokes, name }` and passes the answer through — finish drawings
this way; `box/start.sh` sets it whenever the sidecar came up, unless it is already set.
