# Notices

Kami's own code, documentation and artwork are under the [MIT License](LICENSE). That licence does not
cover the third-party material below, which keeps its own terms.

## The Quick, Draw! Dataset

Kami learns to recognise sketches from, and summons and tidies drawings with, **The Quick, Draw! Dataset**,
made available by Google, Inc. under the
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) licence:
<https://github.com/googlecreativelab/quickdraw-dataset>.

- The dataset is **not** in this repository. `bun run quickdraw:ingest` and `ml/retrain.py` download it from
  Google's public bucket.
- What is derived from it: the recognition model and its exemplar set (built on your own machine, not
  distributed here), the list of its 345 category names (`server/natures/quickdrawCategories.txt`), and the
  drawings shown in `docs/reports/figures/fig5_morph_contact_sheet.png` and in the game whenever Kami
  summons or tidies a drawing. Those drawings are the work of the dataset's contributors; several have been
  modified (cut short, shaken, morphed) as the captions say.
- If you redistribute a model, an exemplar set or drawings made from the dataset, carry this attribution
  with them. CC BY 4.0 asks for credit, a link to the licence and a note of changes; it does not restrict
  the licence of your own code.

## EMS Readability

Kami's handwriting is a converted subset of the single-stroke font EMS Readability, under the SIL Open Font
License 1.1: [`src/handwriting/fonts/LICENSE-EMSReadability.md`](src/handwriting/fonts/LICENSE-EMSReadability.md).

## Libraries

Dependencies are listed in `package.json` and `ml/pyproject.toml` and are installed from their registries
under their own licences; none is vendored here.
