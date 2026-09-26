# Proofreading what the pen wrote

The handwriting reader (`ml/HANDWRITING.md`) is two small general-purpose models. They read neat
writing well and Kami's own words badly: TrOCR, trained on English prose, "corrects" rare words
toward English ("pluto" → "photo", "mars" → "mass", "walks" → "Walkers") and never learned `=`
("daylight - 0.1"); both run words together ("clonealice"). `/api/transcribe` therefore proofreads
every reading against the words the game understands, and — only for a note the player has
finished and the reader was unsure of — may ask a text model for a second opinion.

```
strokes ─► reader (sidecar /read)            text, sureness per character, the screen's reading
             │
             ▼
        VocabularyCorrector (proofread/corrector.ts)   deterministic, ~2 ms a note
             │
             ├─ nothing in doubt ─────────────────────► { text }
             │
             └─ in doubt (proofread/doubt.ts)
                  ├─ a pen-lift read ─────────────────► { text, unsure: true }
                  └─ the settled read ─► LlmRepairer ─► { text }   (proofread text on any failure)
```

## What the reader says (`ml/CONTRACT.md` → `POST /read`)

Beside `text`, the sidecar answers `sureness` — how sure the model that answered was of each
character (CTC symbol probabilities from PP-OCR, token probabilities from TrOCR, carried through
the reader's own tidying by `ml/handwriting/sureness.py`) — and `alternatives`: where TrOCR answered,
what the PP-OCR screen read of the same ink. The screen is the better reader of symbols and of the
game's rare words; TrOCR of messy writing. Their disagreement is the best evidence there is. TrOCR
beam search (true n-best) would cost a second decoder pass per line and was not needed.

## The vocabulary (`proofread/lexicon.ts`)

Built at start-up from the game's own sources of truth, never a hand-kept list:

- the rule grammar's words (`src/rules/lexicon.ts`: every recogniser's vocabulary, the filler it
  skips, the atlas's place names, the travel verbs);
- the wish grammar's words and every name a Quick, Draw! category or scene is summoned by
  (`src/summoning`), over the server's nature table (its categories and display names);
- the Cat's naming lexicon (`src/cat/lexicon.ts`: "eat me", "bouncy", "loyal"…);
- the cast of `docs/spec.md` (Alice, Kami, the Sumikui, the Cheshire Cat, the Rabbit).

About 2 000 game words. Beside them, English from SCOWL (via `wordlist-english`, MIT; the word lists
are Kevin Atkinson's, permissive): sizes 10–20 as *common* (≈ 11 000 words, which a misread may also
snap to) and 35–40 as *rare* (≈ 32 000, which are only protected, never snapped to). English keeps
ordinary words from being forced into game words. `kindOf` reads "it's", "moon's" and "ink-eater"
by their parts.

## The corrector (`proofread/corrector.ts`)

Each word of the reading, in order of the evidence:

1. **Numbers.** Letters that look like digits inside a number become digits (`o.3` → `0.3`,
   `0,5x` → `0.5x`); where the other reading saw a plain quantity close to a garbled one, it is
   taken (`509b` / `50%`).
2. **Game words stay** exactly as read.
3. **Two words run together** — an unknown word that splits into two known words, one of them the
   game's — are split: `clonealice`, `nogravity`, `atiny`. Capitalised words mid-note are names
   and are left alone.
4. **The other reading's game word.** The two readings are aligned word by word
   (`proofread/align.ts`, which also lets one word stand for two: `asely` / `a shy`). Where the
   screen saw a game word (or known words, one of them the game's) and this word is within half an
   edit per letter of it, the screen's word is taken — for an English word only where the reader
   was unsure of it (sureness below 0.8), so "eat me" is not overruled by a screen that saw "cat".
5. **Snapping to the vocabulary.** Otherwise a word of three letters or more is compared with every
   game word and every common English word of about its length by an OCR-weighted edit distance
   (`proofread/ocrDistance.ts`): the edits handwriting readers make cost less (`rn`↔`m` 0.3,
   `m`↔`n` 0.4, `l`↔`i` 0.4, `cl`↔`d` 0.4, `al`↔`d` 0.5, …) and so does any edit to a character
   the reader was unsure of (down to 30 % of its cost). A candidate's score is its cost less a prior
   (game 0.6, common 0.3, rare 0.15); the word changes only when the best candidate beats keeping
   the word by a margin (0.1) and the runner-up by a lead (0.15), and an English word only ever
   snaps to a game word, by an edit costing at most 0.2. Unknown words: `sunikui` → `sumikui`.
6. **Equals signs.** A lone `-` (or `:`, where the other reading saw `=`) between a word that is
   not filler and a number is `=`; after `=`, a lone `I`, `l` or `O` is a digit. "alice pulls at
   - 1 g" keeps its minus.

The tuning lives in `DEFAULT_TUNING`; the evaluation in `ml/HANDWRITING.md` chose it.

## Doubt (`proofread/doubt.ts`)

A note is in doubt when any word is: a number that is not a plain quantity (`05.9`), an English word
the reader was less than 0.8 sure of, or an unknown word of three letters or more the reader was
less than 0.9 sure of (a name read with confidence stands). A game word is never in doubt, however
unsure the reader was: the vocabulary vouches for it. A transcript without sureness (the vision
model's) is never in doubt.

## The second opinion (`proofread/repairer.ts`, `proofread/repairPrompt.ts`)

Only when a text model is configured (`KAMI_LLM_*`; `KAMI_HANDWRITING_REPAIR=off` disables it) and
only for the **settled** read: the pen reads every prefix of the ink on every pen lift
(`src/reading/penReader.ts`), and a model call for each would cost money and time for readings
nobody will use. So a pen-lift read answers `unsure: true`; when the ink settles and the last
reading was unsure, the client asks once more with `settled: true`. The server remembers the last
64 transcripts by their strokes, so that second request does not read the ink again.

The model (through `llm/chatClient.ts`, JSON-schema reply `{"text": string | null}`) is shown what
was read, the other readings, and each doubtful word with its sureness and nearest game words, and a
short description of what players write in Kami. Its answer is trusted only if faithful
(`proofread/faithful.ts`): every word that was not in doubt is still there as it was (numbers
included); every changed word is a game word, a number, or a word one of the readings saw — a
model's guess at a name or an ordinary word is no better than the reader's; at most one word more or
fewer; at most 35 % of the characters changed. `null` ("not writing") is passed on.

Bounds: 4 s, the request's abort signal, at most 2 at once and 120 a minute (beyond that the proofread
text stands), inside the per-process model limits every `/api/transcribe` request already counts
against (`KAMI_MODEL_*`, docs/access.md). The last 256 answers are remembered by question. Any
failure — timeout, HTTP error, garbage, an unfaithful answer — leaves the proofread text.
