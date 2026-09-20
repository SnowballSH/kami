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
bounding box. Training shows the model prefixes (30–100 % of the points, in drawing order) as well as
finished drawings, which is what lets one stateless model guess while the pen is still moving.

## The files a trained model ships as (`ml/artifacts/<name>/`)

| File | |
|---|---|
| `model.onnx` | input `image` as above; outputs `logits` float32 `[N, K]` and `embedding` float32 `[N, 512]` (the pooled features, not normalised). Opset 17, dynamic batch. |
| `labels.json` | array of K Quick, Draw! category names; index = logit index |
| `preprocess.json` | `{ "size": 64, "canvas": 256, "margin": 12, "thickness": 6, "temperature": T, "renderSha256": "<sha of render.py>", "trainedOn": "...", "top1": x, "top3": y }` — `temperature` from temperature scaling on held-out data, so probabilities mean what they say. Additive, optional — see Regimes: `"temperaturePartial": Tp`, `"certainAbove": { "finished": 0.80 \| null, "partial": 0.93 \| null }`; informative only: `temperaturePooled`, `arch`, `selection`, `recipe`, `training` |
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
| `POST /recognize` | `{ "strokes": [[{"x":1,"y":2},...],...], "partial": false, "top": 5 }` | `{ "labels": [...], "probs": [...] }` — best first, temperature-scaled softmax, `top` entries (default 5); plus `"certainAbove": 0.80 \| null` when the model states its floors — see Regimes |
| `POST /embed` | `{ "strokes": ... }` | `{ "embedding": [512 floats, L2-normalised] }` |
| `POST /complete` | `{ "strokes": ..., "name": "a mushroom", "strength": 0.5 }` (`name`, `strength` optional) | `{ "tidied": [[{"x":..,"y":..},...],...], "added": [...], "category": "mushroom", "confidence": 0.93, "similarity": 0.81, "boldness": 0.9, "exemplar": "5152802093400064", "pose": {"mirrored": false, "quarterTurns": 0} }`, or `404 {"error"}` — see Completion |

Strokes arrive raw, in world px; the sidecar owns rendering. Bad input → `400 {"error"}`; never a crash.

The game, Bun API and sidecar share these per-drawing limits: 256 strokes (including empty strokes),
1024 points per stroke, 2048 points in total, finite coordinates within ±1,000,000,000, and 262,144
UTF-8 request bytes. Aggregate counts are checked before converting points or running models.
The sidecar requires a positive Content-Length; Bun also counts streamed bodies without that header.
`src/core/inputLimits.ts` is the client/API contract; the pure sidecar budget test checks parity.
Text notes allow 4000 UTF-16 code units and use a 131,072-byte envelope; controller readings allow
256 bytes. Names allow 80 UTF-16 code units. Limits include both ends. Oversized ink is rejected
with feedback and its pending ink refunded; split detailed sketches into smaller drawings.
Completion results must fit the same combined drawing budget before the client applies them.
Already stored drawings over budget cannot create physics bodies; they are not silently rewritten.

## Regimes — a finished drawing and one still under the pen (additive, version-free)

One temperature cannot serve both looks: label smoothing asks for T < 1 on finished drawings, while
the diffuse posteriors of half-drawn ones need a softer T (the first model: ECE 1.0 % finished,
6.5 % partial). The regime is observable — `/recognize` already carries `partial` — so a model may
ship two temperatures and the confidence from which it can be trusted in each:

- `temperature` is the temperature of **finished** drawings; `temperaturePartial` that of drawings
  still under the pen (`partial: true`). A model without `temperaturePartial` uses `temperature` for
  both, exactly as before. `/embed`, `/complete`, the exemplar builder and `golden.json` always read
  with `temperature`.
- `certainAbove.finished` / `.partial`: the smallest calibrated confidence of the leading guess,
  **after the game's aliases are folded by summing** (`ml/categories/folds.json`, which a test keeps
  equal to the aliases of `server/natures/quickdrawNatures.json`), at which held-out drawings of that
  regime are named right 95 % of the time; rounded up to 4 decimals; `null` when no worthwhile share
  (0.5 %) of them reaches that precision. Fitted on the validation split with the regime's temperature;
  the partial regime pools the 30–50, 50–70 and 70–100 % views.
- When the model states `certainAbove`, `/recognize` answers with the floor of the request's regime
  as `"certainAbove"` (a number, or `null` for never), which the Bun server already prefers to its
  built-in 0.80 / 0.90. A model without it answers without the field, and the server keeps its own.
- Malformed values (`temperaturePartial` not positive and finite, a floor outside (0, 1], a
  `certainAbove` that is not an object) fail start-up like any other incompatible bundle.

Training stays on the 345 fine labels, so completion still retrieves birthday cakes for birthday
cakes; folding happens only where confidence is judged. The tensor, the renderer, the output names
and every older model are untouched: no version field changes.

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

Same body limits, validation and logging as `/recognize`. `name` is optional, a string of at most 80
characters; `null` and `""` mean no name.

1. **Category.** The name — lower-cased, whitespace collapsed, a leading "a", "an" or "the" dropped
   (labels are compared the same way, so "eiffel tower" finds "The Eiffel Tower") — when it is one
   of the labels, or ends with one ("a bouncy mushroom" is a mushroom; the longest such ending
   wins). Otherwise the model's top-1 when its calibrated probability is ≥ 0.5.
   Otherwise no answer.
2. **Exemplar and pose** (`likeness.py`, `pose.py`). The model's embedding knows what kind of cat
   a sketch is, not which way it faces, and an exemplar facing the other way tidies a drawing into
   a mess; so likeness is judged on the ink. Every exemplar of the category, in each of **eight
   poses** (as drawn or mirrored, turned by 0–3 quarter turns), is compared with the sketch as an
   outline — 48 points spread evenly along the ink, centred on its bounds, diagonal 1 — by
   `mean distance(sketch → exemplar) + 0.5 × mean distance(exemplar → sketch)`
   `+ pose cost (0.002 mirrored, 0.008 turned) − 0.03 × cosine(sketch, exemplar)`.
   The six lowest are fitted (below) and scored again the same way on the fitted ink at full
   resolution; the lowest wins. The cosine only breaks ties; the pose costs keep a symmetric
   drawing as it was drawn. The same sketch and name always choose the same exemplar and pose,
   whatever the `strength`.
3. **Morph** (`morph.py`) — the drawing stays the player's; nothing of theirs is replaced.
   - *Fit.* The posed exemplar is laid over the player's ink at one scale for both axes:
     diagonals matched and centred, then the best of a small grid of scales and shifts, then sixteen
     rounds of least squares on nearest points for a shift, a scale (within 0.8–1.25 of the grid's)
     and a turn of **at most 30°**, so an exemplar leans with a drawing that leans. What counts is
     the player's ink lying on the exemplar; the exemplar lying on their ink counts a tenth as much,
     so a half-drawn sketch gets a whole exemplar of the right size around it rather than one
     squeezed into its bounds.
   - *Tidy.* Worked out at stations every 2 % of the diagonal along each stroke and read off at
     the stroke's own points, so a pen that reports a point every pixel is tidied like one that
     reports few. Each station moves toward the place on the fitted exemplar it belongs to:
     - *Where it belongs* is chosen along the whole stroke at once. A line running across the
       stroke's own direction counts as further away (up to 5 % of the diagonal), and a pick that
       lands further from the last one than the pen itself travelled pays for the difference, so a
       line drawn between two of the exemplar's lines settles on one instead of hopping, and a
       line that merely crosses one is not dragged along it.
     - *Ink the exemplar does not explain is left alone*: the share of its shift a station takes
       fades from 1 to 0 between 6 % and 12 % of the diagonal away and between 60° and 32° across
       the exemplar's direction, evened out over a long stretch of the stroke (a line pulled here
       and left there comes out wavy).
     - *A stroke is carried as one piece first* — one shift, a scale within 0.8–1.25 and a turn
       within 15° fitted to its stations' places — and only then reshaped: fully when it already
       lies along the exemplar (mean distance ≤ 2 %), down to a quarter when the exemplar draws it
       differently (≥ 5 %), because a door bent to another drawing's door comes out crumpled.
     - The reshaping is smoothed along the stroke so lines bend rather than jitter, and over a
       long stretch wherever the stroke hops from one of the exemplar's lines to another.
     **How firmly depends on how sure Kami is**: `boldness` = smoothstep(confidence, 0.3 → 0.9) ×
     (1 − smoothstep(misfit, 3 % → 8 % of the diagonal)), where confidence is the model's calibrated
     probability of the category and misfit the mean distance from the player's ink to the fitted
     exemplar. At boldness 0 a station moves half of the way and never more than 6 % of the
     diagonal; at boldness 1, nine tenths of the way and never more than 10 %. A name the model
     does not believe, or an exemplar that lies loosely, keeps his hand light.
   - *Add.* Runs of the fitted exemplar farther than 10 % of the diagonal from any of the tidied ink,
     and at least 15 % of it long, become new strokes — only on a tight fit (misfit ≤ 3 %) and never
     more than one and a half times the player's own ink. A finished drawing usually gets none.
     A run would start a cover radius away from the ink and float beside the drawing; so each one
     grows at both ends for as long as the exemplar keeps coming closer to the ink (until it is
     within 2 %), and starts where the two meet.
   - *The player's slider.* The request's optional `strength` (0–1, default 0.5) runs **from the
     player's drawing to the dataset's**; `care` = min(1, strength / 0.5) and `takeover` =
     max(0, strength − 0.5) / 0.5.
     - *Up to the middle* each point takes `care` of the shift above: 0 moves nothing, 0.5 is
       exactly the tidying above.
     - *Past the middle* Kami takes over, whatever his certainty. A second, exact tidying is worked
       out in which nothing is left alone, carried in one piece or evened out, the pull is a full
       snap with no limit on a move or on reach, and a hop between the exemplar's lines costs four
       times as much (so a snapped stroke does not cut across the drawing). Each point then lies
       `takeover` of the way from its own tidied place to its exact one — so as the slider goes up
       no point ever moves back, and at 1 every point of theirs lies on the exemplar.
     - *What is added* follows the slider too. Its two gates (misfit ≤ 3 %, at most one and a half
       times the player's ink) are multiplied by `care` — nothing is added at 0 — and divided by
       (1 − takeover) — everything the player did not draw is added at 1, where the cover radius
       and the shortest addition have shrunk to 4 %. Two parts added from one of the exemplar's
       strokes never overlap.
     At 1 the drawing is the dataset's, in the player's place, size and pose, drawn with the
     player's strokes first. Anything outside 0–1 is a `400`.
   - *Sampling.* Everything above samples the ink every 2 % of its diagonal, or further apart
     when the ink is so long for its bounds (a scribble going back and forth) that this would take
     more than 1,500 points, because the costs grow with that number and some with its square.

`200 { "tidied", "added", "category", "confidence", "similarity", "boldness", "exemplar", "pose" }`. **`tidied` has exactly
the request's shape** — the same strokes in the same order, each with the same number of points — so a
client can tween point for point from the ink to it. `added` is the missing parts, to be drawn in; they
may lie outside the ink's bounds. Both are in the request's world space, rounded to 0.01 px.
`confidence` is the model's calibrated probability of `category` for the player's sketch (it can be low
when the name decided), `similarity` the cosine to the chosen exemplar, `exemplar` that drawing's
Quick, Draw! `key_id` as a string, `pose` the way it was faced to match the sketch. `404 {"error"}` when the model has no exemplar set or there is no
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
