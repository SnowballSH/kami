# Kami server

Kami's memory and his eyes: a small Bun HTTP API over MongoDB. It remembers every board
(drawings, notes, rules), recognises sketches against Google's Quick, Draw! dataset, and can ask a
model on the GX10 to compile physics notes the offline grammar did not understand.

Nothing in `src/` imports this directory. The browser reaches it through the thin clients in
`src/persistence` and `src/recognition`, on the same origin (`/api`, proxied by Vite in dev). If the
server is down the game still plays; it just is not remembered and Kami guesses from geometry.

## Run

```sh
bun run dev                 # web + server together
bun run server              # server alone, http://localhost:8787, restarts on edits
PORT=8799 bun server/index.ts
```

With no configuration the server starts a real `mongod` (via `mongodb-memory-server`, binary cached
in `node_modules/.cache`) on `127.0.0.1:27117` with its data in `.kami-data/` (gitignored), so
boards survive restarts with zero setup. `Ctrl-C` / `SIGTERM` shuts the `mongod` down cleanly.

| Env | |
|---|---|
| `PORT` | HTTP port, default `8787` (what `vite.config.ts` proxies `/api` to) |
| `MONGODB_URI` | Use this MongoDB instead of the embedded one, e.g. the Atlas `mongodb+srv://…` string. Database `kami`. |
| `KAMI_LLM_URL` | An OpenAI-compatible server for `/api/compile` and `/api/transcribe`: a root (`http://gx10.local:8000`), a `/v1` base, or the full `/v1/chat/completions` URL. vLLM and Ollama both work. |
| `KAMI_LLM_MODEL` | Model name to request. Model compile and handwriting reading are **off** unless both URL and model are set; reading also needs the model to take images (`qwen3.8` does). |
| `KAMI_LLM_API_KEY` | Optional bearer token. |
| `KAMI_CONTROLLER_UDP_PORT` | UDP port physical controllers send to, default `8788`; `off` disables. See `docs/controllers.md`. |
| `KAMI_CONTROLLER_SERIAL` | `auto` (default: every `/dev/ttyACM*`, rescanned every 3 s), a device path, or `off`. The user needs the `dialout` group. |

## Routes

| Route | Answer |
|---|---|
| `GET /api/boards` | `{ boards: BoardSummary[] }` |
| `GET /api/boards/:board` | `{ drawings: StoredDrawing[], notes: Note[], rules: Rule[] }`, oldest first; an unknown board is empty |
| `PUT /api/boards/:board/{drawings,notes,rules}/:id` | upsert; the body is the client's object and its id must match the path |
| `DELETE /api/boards/:board/{drawings,notes,rules}/:id` | remove one (idempotent) |
| `DELETE /api/boards/:board` | clear the board |
| `POST /api/recognize` `{ strokes: {x,y}[][] }` | `{ guesses: string[] }`, best first, at most three, `[]` when unsure or not ingested |
| `POST /api/compile` `{ text }` | `{ rule: CompiledRule \| null }` |
| `POST /api/controllers/:id/state` `<x> <y> [buttons]` (plain text) | `204`; a joystick's whole state, axes -100 … 100 with y up (`docs/controllers.md`) |
| `GET /api/controllers/:id/events` | Server-Sent Events: `{ x, y, held, buttons }` on connect and on every change |
| `GET /api/controllers` | `[{ id, x, y, held, buttons, transport, idleMs }]` |
| `POST /api/transcribe` `{ strokes: {x,y}[][] }` | `{ text: string \| null }` — the strokes read as handwriting, `null` for a drawing; `501` without a model |

Every body is validated with zod (`schemas.ts`, which mirrors `src/*/types.ts` and is checked
against them at compile time). A bad payload is a `400` with `{ error, issues }`; nothing throws
past the router. Entities are loose objects: fields the server does not know are stored and
returned untouched. CORS is wide open, for development.

Collections `drawings`, `notes`, `rules` hold the client's objects as they are plus `boardId`
(and, for drawings, a top-level `id` copied from `drawing.id`), with a unique `{ boardId, id }`
index. `_id` and `boardId` never leave the server.

## Quick, Draw!

```sh
bun run quickdraw:ingest          # 300 drawings per category (default)
bun run quickdraw:ingest 600      # or another N
bun server/quickdraw/reindex.ts   # recompute every feature from the drawings already stored; no network
bun server/quickdraw/evaluate.ts
```

`ingest` range-fetches the first 1.5 MB of
`https://storage.googleapis.com/quickdraw_dataset/full/simplified/<category>.ndjson` for the 42
categories in `quickdraw/categories.ts` (chosen because the Cat's lexicon can use them: mushroom,
ladder, stairs, cloud, hot air balloon, cake, wine bottle, key, door, …, plus the plain shapes),
keeps `recognized: true` drawings, drops the line the byte range cut short, takes the first N and
upserts them into the `quickdraw` collection with their features. It is repeatable; a smaller N or a
shorter category list prunes what is no longer wanted. About 25 s for N = 300; `.kami-data` is
114 MB after a re-index with the prefix features below. **Restart the server afterwards** —
features are loaded into memory once, at startup. Ingest, re-index and evaluate may run while the
server is up (they share its `mongod`, and stop it only if they started it).

The feature (`quickdraw/feature.ts`, shared by ingest and `/api/recognize`): strokes are fitted to
a 24×24 grid by their bounding box (aspect kept, centred, 1.5-cell margin), rasterised with
bilinear line drawing, blurred once with a 3×3 binomial kernel and L2-normalised, so a dot product
is cosine similarity. Player strokes in world px and the dataset's 0–255 grid go through the same
code, which makes recognition independent of where and how large something was drawn.

**Half-finished drawings.** So that the same index can guess while the pen is still moving, every
drawing is indexed at each share of its points in `PREFIX_FRACTIONS` (`quickdraw/prefix.ts`: 20 %,
35 %, 65 % and 100 %). `prefixOfStrokes` takes the first share of the points in drawing order
across strokes, keeps stroke boundaries and cuts the stroke under the pen short; each prefix is
then fitted to *its own* bounding box, exactly as a half-drawn sketch arrives from the player. One
document per drawing holds all of them (`features: [{ fraction, feature }]`), so the unique
`{ category, keyId }` index, the snapshot format and the pruning are unchanged; shares that cut a
short drawing at the same point are stored once. Ingest and snapshot import (so the GX10 too) do
this on the way in. `reindex.ts` does it for a database ingested before prefixes existed, from the
stored drawings alone — 6 s for 12 600 drawings; until it has run, old documents (a single
`feature`) still load, as whole drawings. 12 600 drawings become 50 206 rows: 116 MB of
`Float32Array`, loaded in 0.3 s (the process peaks around 0.6 GB while loading).

The recogniser (`quickdraw/recognizer.ts`) keeps every feature in one flat `Float32Array`, whole
drawings first, and does brute-force cosine k-NN: k = 15, each neighbour votes for its category
with weight similarity⁸, categories are ranked by vote share (the `confidence` the route returns),
and up to three with a share of at least 0.08 are returned. If the single best neighbour is below
0.35 similarity the answer is `[]`. `rank(strokes, { partial })` is synchronous; `read(strokes,
{ partial })` is the same ranking with the vote share above which it may go unasked (`certainAbove`,
see "Naming without asking"), and `recognition/inProcessRanker.ts` wraps that in the promise-returning
shape the recogniser chain speaks.

- **Finished** (`partial` absent or false): compared with the whole-drawing rows only. Same answers
  as before prefixes existed, 4.8 ms per sketch.
- **Still under the pen** (`partial: true`): compared with every row, 19 ms per sketch. Too few
  points is never a reason to refuse, but the answer is `[]` unless the leading category holds at
  least 0.6 of the vote (`partialLeaderFloor`) — Kami takes most of a second to write a guess, so a
  live guess has to be worth writing.

### Measured accuracy

`evaluate.ts` fetches, for each category, the next 50 recognised drawings that are **not** in the
collection (42 × 50 = 2100), shows the recogniser the first 20/40/60/80/100 % of each one's points
as a live guess and the whole drawing once more as a finished one, and scores the answers as the
route would give them (floors included). *Top-1/top-3* ignore the live silence floor, to show what
the ranking knows; *speaks* is how often the live floor lets an answer out and *right when it
speaks* how often that answer's first guess is correct. The last column is the reliability of a
high confidence: how often the leader reaches 0.8, and how often it is right when it does. Index:
42 categories × 300, indexed at 20/35/65/100 %. Single-threaded on an Apple M4, other work running.

| Ink shown | Top-1 | Top-3 | Speaks (leader ≥ 0.6) | Right when it speaks | Confidence ≥ 0.8: how often / right | Per query |
|---|---|---|---|---|---|---|
| 20 %, live | 18.0 % | 38.1 % | 6.2 % | 30.8 % | 1.6 % / 48.5 % | 19 ms |
| 40 %, live | 32.7 % | 57.9 % | 13.0 % | 59.0 % | 3.6 % / 66.7 % | 19 ms |
| 60 %, live | 47.3 % | 69.0 % | 23.0 % | 81.5 % | 8.1 % / 91.8 % | 19 ms |
| 80 %, live | 58.2 % | 78.6 % | 30.4 % | 85.9 % | 13.0 % / 95.2 % | 19 ms |
| 100 %, live | 62.0 % | 81.0 % | 35.4 % | 89.0 % | 15.0 % / 98.1 % | 19 ms |
| 100 %, finished | **65.1 %** | **82.9 %** | always | 65.1 % | 25.3 % / 95.5 % | 4.8 ms |

Over all 10 500 live trials a stated guess is right **79.6 %** of the time and one is stated 21.6 %
of the time. The floor is a trade (`evaluate.ts` prints the sweep): ≥ 0.5 speaks 32.4 % / right
72.7 %, ≥ 0.6 21.6 % / 79.6 %, ≥ 0.7 13.8 % / 86.3 %, ≥ 0.8 8.3 % / 91.4 %. The vote share does not
know how much of the drawing it is looking at, so the rare early answers are the unreliable ones
(a first stroke looks like a finished `line`); from 60 % of the ink on, four stated guesses in five
are right. A client that wants to be surer can wait for a returned confidence of 0.8.

What the prefix rows cost and buy, all measured the same way:

| Index | 20 % | 40 % | 60 % | 80 % | 100 % | Live answers at equal precision |
|---|---|---|---|---|---|---|
| whole drawings only (measured before this change) | 5.4 / 13.1 | 18.5 / 32.4 | 37.3 / 57.7 | 58.0 / 78.1 | 65.1 / 82.9 | — |
| + 35 %, 65 % rows, searched for every query | 14.5 / 30.8 | 35.0 / 60.4 | 49.5 / 71.4 | 60.5 / 80.4 | 63.3 / 81.7 | 27.7 % speak at 72.7 % right |
| + 20 %, 35 %, 65 % rows (now) | 18.0 / 38.1 | 32.7 / 57.9 | 47.3 / 69.0 | 58.2 / 78.6 | 62.0 / 81.0 live, **65.1 / 82.9** finished | 32.4 % speak at 72.7 % right |

Searching the prefix rows for a finished drawing costs 1.8–3.1 points of top-1 and four times the
query time, which is why finished drawings are compared with whole drawings only and keep 65.1 /
82.9. The 20 % rows cost the live ranking about two points in the middle of a drawing but teach
the index what a first stroke looks like in every category: without them high-confidence answers
at 20 % ink were right 17 % of the time instead of 48 % and three times as frequent, and on a
700-sketch subsample 17 of the 28 confident wrong answers at 20 % ink were "line". On the same
subsample more neighbours (k = 30), a sharper vote (16) and also gating on how finished the
neighbours were did not improve the speak/right trade, so they were left out.

Finished drawings, per category (top-1/top-3) — best: line 92/96, door 88/98, fence 88/92, circle
86/90, stairs 82/88, triangle 82/88, wine bottle 80/90, ladder 76/84, hot air balloon 76/94,
mushroom 68/88. Worst: zigzag 20/40 and bird 22/32 (drawn too many ways for a raster match),
birthday cake 44/74 and cake 52/88 (they steal each other's votes; the Cat maps both to "a cake").
N = 600 only bought +2 points for twice the memory and query time, so 300 is the default. k from 5
to 25 and the vote exponent from 1 to 16 move the numbers by about a point. The trained model
(`ml/CONTRACT.md`) replaces the k-NN behind the same route when its sidecar answers; this stays as
the fallback.

## Model-backed compile

`compile/llmCompiler.ts` posts the note to `<KAMI_LLM_URL>/v1/chat/completions` with a system
prompt (`compile/prompt.ts`) that lists every `RuleEffect` variant with its unit and range and asks
for `{"effect": …, "explanation": …}` or `{"effect": null}`. The reply may be wrapped in prose or
code fences; the outermost JSON object is parsed, validated with the same zod schema the board
routes use, and clamped (`compile/effectRanges.ts`): gravity ±30 g per axis, wind ±3 g, timeScale
0.1–3, airDrag and friction 0–10, bounciness 0–1. A missing gloss is written for it. Timeouts
(8 s), HTTP errors, garbage and unknown settings all become `null`, which the client treats as
"not a rule". It has been tested with an injected fetch and end to end against a fake
OpenAI-compatible server, not yet against the real GX10.

## Handwriting reading

`transcribe/llmTranscriber.ts` lets the player write with the pen instead of the text prompt. The
strokes are drawn black-on-white into a small grayscale PNG (`transcribe/strokeImage.ts`, a line of
writing fitted to 64 px tall, no image library) and shown to the same `KAMI_LLM_MODEL` as a vision
model through `llm/chatClient.ts`, the OpenAI-compatible client `/api/compile` also uses, with
`reasoning_effort: "none"` so it answers in one breath (~2 s warm on the GX10; a `400` from a server
that does not know the field retries without it). The prompt (`transcribe/prompt.ts`) asks for
`{"text": "…"}` for words and `{"text": null}` for a drawing; the answer is parsed like the
compiler's, then must read as writing (≤ 80 characters, at least two different letters — a fence
once came back as `IIIIII`). Anything else, a timeout (20 s), an HTTP error or an abort is `null`:
the strokes stay ink. `/api/transcribe` forwards the request's abort signal, so a client that
cancels a read of a prefix costs the model nothing more.

## Two things that would otherwise bite

- **Bun and `bson`.** `bson` 7 probes `v8.startupSnapshot.isBuildingSnapshot()` while it loads, and
  Bun 1.3 throws "not implemented" from it, so `import "mongodb"` crashes. `db/bsonSnapshotShim.ts`
  replaces the probe with `() => false` when it throws, and `db/mongo.ts` loads the driver with a
  dynamic `import()` afterwards (Bun evaluates statically imported CommonJS before any shim could
  run). Import the driver from `db/mongo.ts`, never from `"mongodb"` directly.
- **`bun --watch` and the data directory lock.** A watch reload re-executes the server in place, so
  the `mongod` it spawned is still running and still holds `.kami-data/mongod.lock`. That is why
  the embedded `mongod` has a fixed port: `connectDatabase` first tries to adopt whatever is
  listening there and only spawns one if nothing answers. The server's shutdown stops the `mongod`
  either way; `ingest` and `evaluate` stop it only if they started it.

## Tests

`bunx vitest run server` — every file is `// @vitest-environment node` and the ones that need
MongoDB start their own throwaway in-memory `mongod` (`testing/memoryDatabase.ts`), never
`.kami-data/`.

## API contract (what the client may rely on)

Same origin, JSON unless noted. Additive changes only; anything else is announced in `AGENTS.md`.

| Route | Request | Response |
|---|---|---|
| `POST /api/recognize` | `{ strokes: {x,y}[][], partial?: boolean }` — world px, any scale or position | `{ guesses: string[], confidence: number[], names: string[], natures: Nature[], strengths: number[], lines: string[], certain: boolean }` — parallel arrays, best first, at most three, all empty when unsure. `guesses` are bare Quick, Draw! words, each with a 0–1 `confidence`; the other four say what each guess is for the game (below). `certain: true` means `guesses[0]` may be named without offering the player a choice (see "Naming without asking"); a client that ignores it keeps asking, as before |
| `POST /api/beautify` | `{ strokes: {x,y}[][], name?: string }` | whatever the attached model answers, content-type preserved. With Kami's Eye attached (the box's default): **`application/json` `{ tidied, added, category, confidence, similarity, exemplar }`** — `tidied` is the player's own strokes, point for point, each nudged a bounded distance toward a clean drawing of the same thing; `added` is what theirs was missing (`ml/CONTRACT.md`, "Completion"). Another model may answer an image (`image/png`, `image/webp`). **`501`** `{ error }` when no model is attached (`KAMI_BEAUTIFY_URL`) or it failed — keep the player's own ink. |
| `POST /api/compile` | `{ text }` | `{ rule: CompiledRule \| null }` |
| `POST /api/transcribe` | `{ strokes: {x,y}[][] }` — at least one stroke, world px | `{ text: string \| null }` — what the pen wrote, whitespace collapsed, `null` when the strokes are a drawing or the reader is unsure. **`501`** `{ error }` when no model is attached (`KAMI_LLM_URL`/`KAMI_LLM_MODEL`). Stateless; the client may abort a request (the read of a prefix) freely. |
| boards, drawings, notes, rules | see the table above | |
| `POST /api/controllers/:id/state` | `text/plain` `<x> <y> [buttons]`, e.g. `100 0 A`: axes -100 … 100 (y up), then the letters of the buttons held (`A` `B` `X` `Y`). `:id` is `[a-z0-9-]{1,32}` | `204`, or `400` `{ error }` |
| `GET /api/controllers/:id/events` | — | `text/event-stream`: `retry: 1000`, then `data: {"x":-0.7,"y":0.85,"held":["left","up"],"buttons":["a"]}` on connect and on every change (`x`, `y` -1 … 1; `held` of `left` `right` `up` `down`, with `up` also while `a` is held; everything let go after 1 s without a message), and `: keep-alive` every 5 s |
| `GET /api/controllers` | — | `[{ id, x, y, held, buttons, transport: "udp" \| "serial" \| "http", idleMs }]`, forgotten after a minute of silence |

The controller routes are the HTTP face of `server/controllers/` (UDP `:8788` and USB serial feed the same
hub); the whole protocol, the Arduino sketch included, is `docs/controllers.md`.

**Live guessing.** `partial: true` marks a drawing still under the pen. The route is stateless on purpose:
post the strokes so far every ~150 ms and the whole prefix is re-read each time — at a few hundred points
that is far cheaper than keeping per-pen state on the server, and it survives dropped requests. With the
flag set the answer is **all-empty until the recogniser is sure**: the k-NN also searches half-finished
sketches and stays silent unless the leading category holds 0.6 of the vote; Kami's Eye is trained on
prefixes and reads a half-drawn sketch like any other. An empty answer to a partial look means "nothing to
say yet" — keep the last guess on screen. The client for all of this is `src/recognition`
(`LiveRecognizer.sight(strokes, { partial })` → `Sighting[]`).
Strokes returned by `beautify` are in the same world space as the request.

**Naming without asking.** When Kami is sure what a drawing is, the game names it instead of offering three
guesses. The server decides, because only it knows which recogniser answered and how far that one's
confidence can be trusted: every answer in the chain is a `Reading { ranking, certainAbove }`
(`recognition/types.ts`), where `certainAbove` is the leader confidence from which the answer may be taken
without asking, or `null` for never. `certain` is true only when, **after** aliases are folded together,
there is a leader whose summed, unrounded confidence reaches the `certainAbove` of the recogniser that
answered; an all-empty answer is never certain. The floors are the points of 95 % precision on held-out
drawings:

| Recogniser | Finished | Still under the pen | Measured in |
|---|---|---|---|
| Kami's Eye (the sidecar), calibrated confidence | ≥ 0.80 — right 95 % of the time, 65 % of drawings | ≥ 0.90 — right 95 % of the time on drawings at least half done, 36 % of them; below half the ink no threshold reaches 95 % | [`docs/reports/kami-eye-results.md`](../docs/reports/kami-eye-results.md), Figure 3, test split |
| k-NN, leading vote share | ≥ 0.8 — right 95.5 % of the time, 25 % of drawings | never: a share ≥ 0.8 is right only 48.5 % of the time at 20 % of the ink and 66.7 % at 40 %, and the k-NN cannot tell how much of the drawing it sees | [`docs/reports/prefix-knn.md`](../docs/reports/prefix-knn.md) |

The k-NN's pair is `certainAbove` in `DEFAULT_RECOGNIZER_OPTIONS`; the sidecar's is
`DEFAULT_CERTAINTY_FLOORS` in `recognition/remoteRecognizer.ts`, used until the sidecar states its own: a
`certainAbove` in its `/recognize` answer (a number in 0–1, or `null`) replaces the default, and anything
else there is ignored. The browser reads the flag as `Sighting.certain`, true at most on the first
sighting; an older server without the field reads as `false` everywhere.

**From a noun to physics.** Every guess arrives already ruled on, from the reviewed table
`server/natures/quickdrawNatures.json` (all 345 Quick, Draw! categories, validated against `NATURES` at
start-up, compiled once — no model is asked at play time). Index `i` of each array describes `guesses[i]`:

| Field | |
|---|---|
| `names[i]` | the display name as Kami writes it, article included: `"a mushroom"`, `"an anvil"`, `"stairs"`, `"The Eiffel Tower"` |
| `natures[i]` | one of `NATURES` in `src/cat/types.ts` (`"bouncy"`, `"grow"`, `"ink"`, …) |
| `strengths[i]` | within `STRENGTH_RANGE` (0.5–2); 1 unless the thing is notably more or less so (a whale 2, a feather 0.6) |
| `lines[i]` | Kami's one-line reaction, twelve words or fewer |

Categories that are one thing for the game are folded together before the best three are chosen, their
confidence summed: `birthday cake` → `cake`, `coffee cup` and `mug` → `cup`, `ceiling fan` → `fan`,
`school bus` → `bus`, `pickup truck` → `truck`, `police car` → `car`, `goatee` → `beard`, `smiley face` →
`face`. So `guesses` only ever holds the canonical word, and a client that reads just `guesses` and
`confidence` keeps working unchanged. A word the table has never met is `"ink"`, strength 1.

## Running everything on the ASUS Ascent GX10

All computation happens on the box; the Mac edits, tests and ships.

```
iPad ──venue Wi-Fi──►  GX10 (`ssh gx10`):  game + API (:8787) ─► MongoDB (:27017, local)
                                                              ├► Ollama  (:11434, local)  qwen3.8 compiles rules
                                                              └► Kami's Eye (:8790, local) ONNX sidecar, else the k-NN
                       ~/kami-ml: the training kit (`ml/`), its CUDA venv, the data and the trained models
```

The box (`gx10-e861`, GB10, 121 GB, Ubuntu 24.04, CUDA 13) is on the venue network with internet, key login
and passwordless sudo. Everything Kami needs lives under `~/kami`, nothing system-wide.

```bash
bun run gx10:bootstrap <address>   # once per box or address: SSH key + the `gx10` host alias
bun run gx10:prepare               # build, bundle the server to one file, export the Quick, Draw! snapshot,
                                   #   fetch Bun + MongoDB for Linux arm64 and the sidecar's wheels (.gx10/cache)
bun run gx10:deploy                # ship, install, (re)start, health-check → .gx10/deploy.log
                                   #   add --autostart to bring Kami back whenever the box boots
```

Then on the iPad: `http://<box address>:8787`. On the box, `~/kami/current/box/status.sh` shows what is running
(and the Eye's health) and `stop.sh` / `start.sh` do what they say.

Preparation writes `app/runtime.json` with exact Bun/MongoDB versions, archive names, Python target,
locked requirements digest, and SHA-256 hashes for every archive and wheel. Installation verifies those
files, probes the extracted binaries' versions, and publishes Bun, MongoDB and Python dependencies
together through an atomic `runtime/current` symlink. Older runtime bundles remain available; multiple
cached archive versions cannot change which one is selected. Legacy unpacked runtime directories fail
with a migration message: deploy into a fresh staged release rather than deleting a running runtime.

Eye preparation requires `uv export --locked`; export and download failures abort preparation, without
an unpinned fallback. Downloads and installation use pip's `--require-hashes`. An offline wheel cache
is reused only when its requirements digest, Python target and every wheel hash match. To deliberately
prepare without Eye, set `KAMI_EYE_ENABLED=0`. Transfer repairs mismatched cache files through verified
temporary files. Archive hashes protect cache/transfer integrity; initial archives still rely on the
official HTTPS download sources. Validate actual Linux arm64 binaries on GX10 before rollout.

Deployments upload a complete checksummed release into `~/kami/releases/<id>` and install its
dependencies before touching running services. Only then does activation switch `~/kami/current`.
Application readiness requires the exact client HTML and a valid board-list API response; failure
restarts the previous release. `~/kami/previous` retains the last working release for manual rollback:
`bash ~/kami/current/box/activate.sh "$(readlink -f ~/kami/previous)"`.
The first deployment preserves the old flat layout for rollback; use `current/box` commands afterward.
An existing Kami boot entry is migrated to `current/box/start.sh` after successful activation.
Deploying without `--autostart` leaves autostart disabled when no Kami boot entry exists.
If `previous` points to the legacy `~/kami` layout, use its original `~/kami/box/start.sh` for
manual recovery; it predates the release manifest needed by `activate.sh`.
MongoDB data, logs, PID files and the download cache stay outside releases under `~/kami`.
Rollback restores code and dependencies, not database mutations; no database downgrade/migration is
performed. Interrupted uploads leave the active release untouched. A power loss during activation
requires starting `current/box/start.sh` (or selecting `previous`) after inspecting logs.

How it fits: the server serves the built game itself (`KAMI_WEB_DIR`, `server/http/staticSite.ts`), so one
process is the product. `bun build` bundles it to a single `server.js`, so the box needs no
`node_modules`. `server/quickdraw/snapshot.ts` exports the k-NN's drawings on the Mac and imports them on
the box, recomputing features (prefixes included) on arrival; `start.sh` re-imports whenever the snapshot
or the importer changes. The game asks the language model **last** — the offline grammar and known names
are instant — and the server warms it at start.

**Kami's Eye on the box.** Training runs there (`ml/README.md`), and `start.sh` serves the model it finds at
`~/kami-ml/artifacts/kami-eye` (`KAMI_EYE_MODEL_NAME` picks another; a model shipped from `ml/artifacts` is
the fallback) with the sidecar code the deploy shipped to `~/kami/app/eye`. A retrained model needs only
`~/kami/current/box/start.sh`. No model, no Python packages, or a sidecar that does not come up: the k-NN answers,
and the start-up log says which.

For development on the Mac, `bun run gx10:tunnel` forwards the box's Ollama to `localhost:11434` (what
`.env.local` points at).
