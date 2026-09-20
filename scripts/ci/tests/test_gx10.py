"""Exercise the SSH boundary with stub commands; never import or execute ML."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SCRIPT = REPO / "scripts/ci/gx10.sh"
REVISION = "a" * 40


class Gx10CheckTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.calls = self.root / "calls"
        self.program = self.root / "remote.sh"

    def command(self, name: str, body: str) -> None:
        path = self.bin / name
        path.write_text("#!/usr/bin/env bash\nset -euo pipefail\n" + body)
        path.chmod(0o755)

    def run_check(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(SCRIPT), *args],
            cwd=REPO,
            env={
                **os.environ,
                "PATH": f"{self.bin}:{os.environ['PATH']}",
                "HOME": str(self.root),
                "CALLS": str(self.calls),
                "PROGRAM": str(self.program),
            },
            capture_output=True,
            text=True,
            check=False,
            timeout=10,
        )

    def test_rejects_unsafe_identifiers_before_ssh(self) -> None:
        self.command("ssh", 'echo called > "$CALLS"\nexit 99\n')
        for arguments in [(), ("main", "smoke"), (REVISION, "../active"), (REVISION, "x;id")]:
            with self.subTest(arguments=arguments):
                result = self.run_check(*arguments)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(self.calls.exists())

    def test_ssh_failure_is_not_hidden_by_log_writer(self) -> None:
        self.command("ssh", 'printf "%s\\n" "$@" > "$CALLS"\ncat > "$PROGRAM"\nexit 17\n')
        result = self.run_check(REVISION, "smoke")
        self.assertEqual(result.returncode, 17)
        self.assertEqual(
            self.calls.read_text().splitlines(),
            [
                "-o",
                "BatchMode=yes",
                "-o",
                "ConnectTimeout=10",
                "gx10",
                "bash",
                "-s",
                "--",
                REVISION,
                "smoke",
            ],
        )

    def test_wrong_remote_architecture_stops_before_any_model_command(self) -> None:
        self.command("ssh", 'cat > "$PROGRAM"\nbash "$PROGRAM" a smoke\n')
        self.command("uname", 'case "$1" in -s) echo Linux;; -m) echo x86_64;; esac\n')
        self.command("nvidia-smi", 'echo called > "$CALLS"\nexit 99\n')
        result = self.run_check(REVISION, "smoke")
        self.assertEqual(result.returncode, 1)
        self.assertIn("require the Linux/aarch64 GX10", result.stdout)
        self.assertFalse(self.calls.exists())

    def test_wrong_gpu_stops_before_checkout_or_model_commands(self) -> None:
        self.command("ssh", 'cat > "$PROGRAM"\nbash "$PROGRAM" a smoke\n')
        self.command("uname", 'case "$1" in -s) echo Linux;; -m) echo aarch64;; esac\n')
        self.command("nvidia-smi", "echo 'NVIDIA other GPU'\n")
        self.command("git", 'echo called > "$CALLS"\nexit 99\n')
        result = self.run_check(REVISION, "smoke")
        self.assertEqual(result.returncode, 1)
        self.assertIn("require the GX10's NVIDIA GB10", result.stdout)
        self.assertFalse(self.calls.exists())

    def remote_checkout(self, revision: str = REVISION, dirty: bool = False) -> None:
        self.command("ssh", f'cat > "$PROGRAM"\nbash "$PROGRAM" {REVISION} smoke\n')
        self.command("uname", 'case "$1" in -s) echo Linux;; -m) echo aarch64;; esac\n')
        self.command("nvidia-smi", "echo 'NVIDIA GB10'\n")
        status = " M changed.py" if dirty else ""
        self.command(
            "git",
            f'case "$1" in rev-parse) echo "{revision}";; status) printf "{status}";; esac\n',
        )
        (self.root / "kami-checkouts" / REVISION / "ml").mkdir(parents=True)
        (self.root / "kami-ml/artifacts/smoke").mkdir(parents=True)
        (self.root / "kami-ml/.venv").mkdir()
        (self.root / "kami-ml/.venv/bin").symlink_to(self.bin, target_is_directory=True)
        self.command(
            "python",
            'printf "%s\\n" "$*" >> "$CALLS"\n'
            'if [[ "$1" == validate_release.py ]]; then echo fixture-release-identity; fi\n',
        )

    def test_wrong_revision_stops_before_model_commands(self) -> None:
        self.remote_checkout(revision="b" * 40)
        self.assertEqual(self.run_check(REVISION, "smoke").returncode, 1)
        self.assertFalse(self.calls.exists())

    def test_dirty_checkout_stops_before_model_commands(self) -> None:
        self.remote_checkout(dirty=True)
        self.assertEqual(self.run_check(REVISION, "smoke").returncode, 1)
        self.assertFalse(self.calls.exists())

    def test_valid_remote_run_records_identity_and_runs_golden_suite(self) -> None:
        self.remote_checkout()
        result = self.run_check(REVISION, "smoke")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f"revision={REVISION}", result.stdout)
        self.assertIn("fixture-release-identity", result.stdout)
        self.assertIn("GX10 checks passed", result.stdout)
        calls = self.calls.read_text().splitlines()
        self.assertIn(f"validate_release.py {self.root}/kami-ml/artifacts/smoke", calls)
        self.assertIn("-m mypy .", calls)
        self.assertIn("-m pytest -p no:cacheprovider -v", calls)


if __name__ == "__main__":
    unittest.main()
