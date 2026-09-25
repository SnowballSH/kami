# Repository checks

`Checks` runs on every pull request and push to main, using the Bun version in
`package.json`, frozen `bun.lock`, and the existing `bun run check` and `bun run build`.
No model endpoint or deployment credential is supplied to hosted CI.

`bun run check:lightweight` requires uv 0.12.13. It installs only the locked `check`
group (Ruff and mypy) into `.cache/check-venv`, leaving any ML environment intact.
It runs:

- Ruff lint and format for all ML Python.
- Strict mypy on the dependency-free artifact/prefetch helpers and their unit tests. Full ML
  typechecking needs an environment with the training dependencies.
- Python syntax checks and Bash syntax checks for all tracked/new source scripts.
- Pure artifact/prefetch tests.

It does not discover `ml/tests`: its fixtures construct and execute real ONNX models.
Those tests run on any machine with the training dependencies and a trained artifact
(`ml/README.md`); the input-boundary tests in that directory also remain outside the hosted
test selection.

## Model checks

Model inference, full ML typechecking, pytest and golden parity need the training
dependencies and a trained artifact, so hosted CI does not run them. Run them on a machine
that has both, as `ml/README.md` describes, and validate the artifact with
`ml/validate_release.py` before serving it.

## Optional cabinet checks

The hosted jobs do not compile firmware, test the browser's serial integration or
validate physical controls. The workflow summary labels these checks as unperformed.
Cabinet acceptance remains a separate hardware task; see `docs/hardware.md`.
