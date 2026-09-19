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
| `KAMI_LLM_URL` | An OpenAI-compatible server for `/api/compile`: a root (`http://gx10.local:8000`), a `/v1` base, or the full `/v1/chat/completions` URL. vLLM and Ollama both work. |
| `KAMI_LLM_MODEL` | Model name to request. Model compile is **off** unless both URL and model are set. |
| `KAMI_LLM_API_KEY` | Optional bearer token. |

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
0.35 similarity the answer is `[]`. `rank(strokes, { partial })` is synchronous;
`asAsyncRecognizer` wraps it in the promise-returning shape the recogniser chain speaks.

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
| `POST /api/recognize` | `{ strokes: {x,y}[][], partial?: boolean }` — world px, any scale or position | `{ guesses: string[], confidence: number[], names: string[], natures: Nature[], strengths: number[], lines: string[] }` — parallel arrays, best first, at most three, all empty when unsure. `guesses` are bare Quick, Draw! words, each with a 0–1 `confidence`; the other four say what each guess is for the game (below) |
| `POST /api/beautify` | `{ strokes: {x,y}[][], name: string }` | whatever the attached model answers, content-type preserved: **`application/json` `{ strokes: {x,y}[][] }`** (preferred — drawn with the pen, scales with zoom, fits the whiteboard) or an image (`image/png`, `image/webp`). **`501`** `{ error }` when no model is attached (`KAMI_BEAUTIFY_URL`) or it failed — keep the player's own ink. |
| `POST /api/compile` | `{ text }` | `{ rule: CompiledRule \| null }` |
| boards, drawings, notes, rules | see the table above | |

**Live guessing.** `partial: true` marks a drawing still under the pen. The route is stateless on purpose:
post the strokes so far every ~150 ms and the whole prefix is re-read each time — at a few hundred points
that is far cheaper than keeping per-pen state on the server, and it survives dropped requests. The flag
changes nothing for the k-NN; the trained streaming model will use it (no "I give up" on three points).
Returned strokes from `beautify` are in the same world space as the request, fitted to the sketch's bounds.

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

The goal: all computation on the box, nothing on a laptop during the demo.

```
iPad ──Wi-Fi "gx10-4d82"──►  GX10 (10.13.37.1):  game + API (:8787) ─► MongoDB (:27017, local)
                                                                    └► Ollama  (:11434, local) qwen3.8
```

The box (`gx10-d8fb`, GB10, 121 GB, Ubuntu 24.04) serves its own Wi-Fi, has **no internet**, no
passwordless sudo, and already has Ollama with `qwen3.8` and `nemotron-3.5-lightning`. So the Mac
carries everything to it and installs under `~/kami` — nothing system-wide, nothing needing sudo.

```bash
bun run gx10:bootstrap   # once, on the box's Wi-Fi: installs an SSH key (you type the password once)
bun run gx10:prepare     # with internet: build, bundle the server to one file, export the Quick, Draw!
                         #   snapshot, fetch Bun + MongoDB for Linux arm64 into .gx10/cache (156 MB, once)
bun run gx10:deploy      # on the box's Wi-Fi: ship, install, (re)start, health-check → .gx10/deploy.log
                         #   add --autostart to bring Kami back whenever the box boots
```

Then on the iPad: join `gx10-4d82`, open `http://10.13.37.1:8787`. On the box, `~/kami/box/status.sh`
shows what is running and `stop.sh` / `start.sh` do what they say.

How it fits: the server serves the built game itself (`KAMI_WEB_DIR`, `server/http/staticSite.ts`), so one
process is the product. `bun build` bundles it to a single `server.js`, so the box needs no
`node_modules`. The box can't run the Quick, Draw! ingest, so `server/quickdraw/snapshot.ts` exports the
drawings on the Mac and imports them there, recomputing features on arrival. The game asks the model
**last** — the offline grammar and known names are instant — and the server warms the model at start.

For development on the Mac instead, `bun run gx10:tunnel` forwards the box's Ollama to `localhost:11434`
(what `.env.local` points at). The Mac has one Wi-Fi radio, so staying online while on the box's Wi-Fi
needs internet on another interface (iPhone USB tethering, or Ethernet to the box with a USB-C adapter).

**Not yet run on the box:** `install.sh` / `start.sh`. Known unknowns the first deploy will answer:
whether MongoDB 8.2 is happy with the kernel's page size, and whether the box's firewall lets the
Wi-Fi reach port 8787 (if not: `sudo ufw allow 8787/tcp` on the box).
