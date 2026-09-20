import io
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import runtime

REPO = Path(__file__).resolve().parents[3]
PYTHON = f"{sys.version_info.major}.{sys.version_info.minor}"


class RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.app = self.root / "app"
        self.cache = self.root / "cache"
        self.app.mkdir()
        self.cache.mkdir()
        self.archives("1.2.3", "8.2.6")
        self.manifest("1.2.3", "8.2.6")

    def archives(self, bun: str, mongo: str, output: str | None = None) -> None:
        with zipfile.ZipFile(
            self.cache / f"bun-linux-aarch64-{bun}.zip", "w"
        ) as archive:
            archive.writestr(
                "bun-linux-aarch64/bun", f"#!/bin/sh\necho '{output or bun}'\n"
            )
        with tarfile.open(
            self.cache / f"mongodb-linux-aarch64-ubuntu2404-{mongo}.tgz", "w:gz"
        ) as archive:
            script = f"#!/bin/sh\necho 'db version v{mongo}'\n".encode()
            member = tarfile.TarInfo(
                f"mongodb-linux-aarch64-ubuntu2404-{mongo}/bin/mongod"
            )
            member.size = len(script)
            archive.addfile(member, io.BytesIO(script))

    def manifest(self, bun: str, mongo: str) -> None:
        runtime.write(self.app, self.cache, bun, mongo, PYTHON)

    def wheel_cache(self) -> tuple[Path, Path]:
        eye = self.app / "eye"
        eye.mkdir(exist_ok=True)
        requirements = eye / "requirements.txt"
        requirements.write_text("fixture==1.0 --hash=sha256:" + "1" * 64)
        wheels = self.cache / "wheels"
        wheels.mkdir(exist_ok=True)
        (wheels / "fixture-1.0-py3-none-any.whl").write_bytes(b"unit fixture")
        runtime.seal_wheels(wheels, requirements, PYTHON)
        return wheels, requirements

    def shell(
        self, action: str, requirements: Path
    ) -> subprocess.CompletedProcess[str]:
        commands = self.root / "bin"
        commands.mkdir(exist_ok=True)
        for command in ("uv", "uvx"):
            executable = commands / command
            executable.write_text("#!/bin/sh\nexit 19\n")
            executable.chmod(0o755)
        return subprocess.run(
            [
                "bash",
                "-c",
                f"set -euo pipefail; source scripts/gx10/eye-deps.sh; "
                f"BOX_PLATFORMS=(manylinux2014_aarch64); {action}",
            ],
            cwd=REPO,
            env={
                **os.environ,
                "PATH": f"{commands}:{os.environ['PATH']}",
                "EYE_BUILD": str(requirements.parent),
                "WHEELS": str(self.cache / "wheels"),
                "BOX_PYTHON": PYTHON,
            },
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_redeploy_and_upgrade_select_exact_archives(self) -> None:
        self.archives("9.9.9", "9.9.9")
        runtime.install(self.root)
        previous = (self.root / "runtime/current").resolve()
        runtime.install(self.root)
        self.assertEqual((self.root / "runtime/current").resolve(), previous)
        self.archives("1.2.4", "8.2.7")
        self.manifest("1.2.4", "8.2.7")
        runtime.install(self.root)
        self.assertNotEqual((self.root / "runtime/current").resolve(), previous)
        self.assertTrue((previous / "bun").exists())
        self.assertEqual(
            subprocess.check_output(
                [self.root / "runtime/bun", "--version"], text=True
            ),
            "1.2.4\n",
        )

    def test_corrupt_archive_and_wrong_version_preserve_active_bundle(self) -> None:
        runtime.install(self.root)
        previous = (self.root / "runtime/current").resolve()
        self.archives("1.2.4", "8.2.7", output="wrong-version")
        self.manifest("1.2.4", "8.2.7")
        with self.assertRaisesRegex(ValueError, "requested version"):
            runtime.install(self.root)
        self.assertEqual((self.root / "runtime/current").resolve(), previous)
        (self.cache / "bun-linux-aarch64-1.2.4.zip").write_bytes(b"truncated")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            runtime.install(self.root)
        self.assertEqual((self.root / "runtime/current").resolve(), previous)

    def test_redeploy_checks_installed_version(self) -> None:
        runtime.install(self.root)
        (self.root / "runtime/bun").write_text("#!/bin/sh\necho wrong\n")
        with self.assertRaisesRegex(ValueError, "requested version"):
            runtime.install(self.root)

    def test_legacy_runtime_fails_without_deleting_it(self) -> None:
        legacy = self.root / "runtime/mongodb"
        legacy.mkdir(parents=True)
        (legacy / "sentinel").touch()
        with self.assertRaisesRegex(ValueError, "staged release"):
            runtime.install(self.root)
        self.assertTrue((legacy / "sentinel").exists())

    def test_failed_export_has_no_unpinned_fallback(self) -> None:
        _, requirements = self.wheel_cache()
        original = requirements.read_bytes()
        result = self.shell("pin_eye_requirements", requirements)
        self.assertEqual(result.returncode, 19)
        self.assertEqual(requirements.read_bytes(), original)

    def test_offline_cache_reuse_requires_matching_requirements_and_hashes(
        self,
    ) -> None:
        wheels, requirements = self.wheel_cache()
        result = self.shell("gather_eye_wheels", requirements)
        self.assertEqual(result.returncode, 0, result.stderr)
        requirements.write_text("fixture==2.0")
        result = self.shell("gather_eye_wheels", requirements)
        self.assertEqual(result.returncode, 19)
        self.assertTrue((wheels / "fixture-1.0-py3-none-any.whl").exists())
        runtime.seal_wheels(wheels, requirements, PYTHON)
        (wheels / "fixture-1.0-py3-none-any.whl").write_bytes(b"corrupt")
        result = self.shell("gather_eye_wheels", requirements)
        self.assertEqual(result.returncode, 19)

    def test_failed_pip_does_not_activate_new_runtime_or_dependencies(self) -> None:
        runtime.install(self.root)
        previous = (self.root / "runtime/current").resolve()
        self.wheel_cache()
        self.manifest("1.2.3", "8.2.6")
        with (
            patch("runtime.check_versions"),
            patch(
                "runtime.subprocess.run",
                side_effect=subprocess.CalledProcessError(1, "pip"),
            ) as run,
            self.assertRaises(subprocess.CalledProcessError),
        ):
            runtime.install(self.root)
        command = run.call_args.args[0]
        self.assertIn("--require-hashes", command)
        self.assertIn("--no-index", command)
        self.assertEqual((self.root / "runtime/current").resolve(), previous)
        self.assertFalse((self.root / "pydeps").exists())

    def test_modified_requirements_or_wheels_fail_before_install(self) -> None:
        wheels, requirements = self.wheel_cache()
        self.manifest("1.2.3", "8.2.6")
        requirements.write_text("fixture")
        with self.assertRaisesRegex(ValueError, "requirements"):
            runtime.install(self.root)
        runtime.seal_wheels(wheels, requirements, PYTHON)
        self.manifest("1.2.3", "8.2.6")
        (wheels / "fixture-1.0-py3-none-any.whl").write_bytes(b"corrupt")
        with self.assertRaisesRegex(ValueError, "checksum"):
            runtime.install(self.root)
