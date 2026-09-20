# Repository checks

`Checks` runs on every pull request and push to main, using the Bun version in
`package.json`, frozen `bun.lock`, and the existing `bun run check` and `bun run build`.
No model endpoint or deployment credential is supplied to hosted CI.

`bun run check:lightweight` requires uv 0.12.13. It installs only the locked `check`
group (Ruff and mypy) into `.gx10/check-venv`, leaving any ML environment intact.
It runs:

- Ruff lint and format for all ML Python and CI tests; basic `E4/E7/E9/F` lint for
  deployment helpers (which live outside the ML lint configuration).
- Strict mypy on the dependency-free artifact/prefetch and deployment helpers and
  their unit tests. Full ML typechecking needs the GX10's torch environment.
- Python syntax checks and Bash syntax checks for all tracked/new source scripts.
- Pure artifact/prefetch tests, mocked deployment/runtime tests and CI guard tests.

It does not discover `ml/tests`: its fixtures construct and execute real ONNX models.
Even their tiny models belong on GX10. The input-boundary tests in that directory
also remain outside the hosted test selection.

## Model checks: explicit GX10 run

After the GX10 owner approves a run, provision a **separate clean checkout** of the
revision at `~/kami-checkouts/<full-commit-sha>` on GX10. The existing CUDA environment
at `~/kami-ml/.venv` must have the training and dev dependencies already installed.
Do not run `uv sync` on that environment: it can replace its CUDA build.

From the editing machine:

```sh
bun run check:gx10 <full-commit-sha> <artifact-name>
```

The command always uses `ssh gx10`, requires Linux/aarch64 with an NVIDIA GB10,
verifies a clean checkout at the requested revision, and resolves the artifact under
`~/kami-ml/artifacts/<artifact-name>` once. It validates the release before running
full ML mypy and pytest, including golden parity. Missing artifacts or torch fail
the command instead of making those checks silently skip. The local
`.gx10/check-<revision>-<artifact-name>.log` records source revision, artifact path,
release identity, environment versions and command results. Attach it to the PR.
The script never provisions a checkout, installs packages, deploys, restarts a live
service or starts a training run. Test-created models and temporary sidecars run
only on GX10.

## Optional cabinet checks

The hosted jobs do not compile firmware, test the browser's serial integration or
validate physical controls. The workflow summary labels these checks as unperformed.
Cabinet acceptance remains a separate hardware task; see `docs/hardware.md`.
