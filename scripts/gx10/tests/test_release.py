import io
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import release

BOX = Path(__file__).resolve().parents[1] / "box"


class ReleaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.home = self.root / "kami"
        self.home.mkdir()
        self.events = self.root / "events"
        self.commands = self.root / "bin"
        self.commands.mkdir()
        self.env = {
            **os.environ,
            "KAMI_HOME": str(self.home),
            "EVENTS": str(self.events),
            "PATH": f"{self.commands}:{os.environ['PATH']}",
        }
        python = self.commands / "python3"
        python.write_text(
            "#!/usr/bin/env bash\n"
            'if [ "$2" = ready ]; then\n'
            '  echo "ready:$(basename "$3")" >> "$EVENTS"\n'
            '  [ "${FAIL:-}" != ready ] || [ "$(basename "$3")" != new ]\n'
            "else\n"
            f'  exec "{shutil.which("python3")}" "$@"\n'
            "fi\n"
        )
        python.chmod(0o755)
        self.old = self.make_release("old")
        self.new = self.make_release("new")
        (self.home / "current").symlink_to(self.old)

    def make_release(self, name: str) -> Path:
        directory = self.home / "releases" / name
        for part in ("dist", "app", "box", "runtime/mongodb/bin"):
            (directory / part).mkdir(parents=True, exist_ok=True)
        for required in release.REQUIRED:
            (directory / required).write_text("fixture")
        shutil.copy(BOX / "release.py", directory / "box/release.py")
        for phase in ("install", "start", "stop"):
            (directory / f"box/{phase}.sh").write_text(
                "#!/usr/bin/env bash\nset -eu\n"
                'root=$(cd -P "$(dirname "$0")/.." && pwd)\n'
                'name=$(basename "$root")\n'
                f'echo "{phase}:$name" >> "$EVENTS"\n'
                f'[ "${{FAIL:-}}" != {phase} ] || [ "$name" != new ]\n'
            )
        for executable in ("runtime/bun", "runtime/mongodb/bin/mongod"):
            path = directory / executable
            path.write_text("#!/bin/sh\nexit 0\n")
            path.chmod(0o755)
        release.write(directory)
        return directory

    def activate(self, failure: str = "") -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", str(BOX / "activate.sh"), str(self.new)],
            env={**self.env, "FAIL": failure},
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )

    def test_success_switches_only_after_install_and_keeps_shared_data(self) -> None:
        (self.home / "data").mkdir()
        (self.home / "data/sentinel").write_text("database")
        result = self.activate()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.home / "current").resolve(), self.new)
        self.assertEqual((self.home / "previous").resolve(), self.old)
        self.assertEqual((self.new / "data/sentinel").read_text(), "database")
        self.assertEqual(
            self.events.read_text().splitlines(),
            [
                "install:new",
                "stop:old",
                "start:new",
                "ready:new",
            ],
        )

    def test_corrupt_upload_and_failed_install_do_not_stop_live_release(self) -> None:
        for failure in ("upload", "install"):
            with self.subTest(failure=failure):
                if failure == "upload":
                    (self.new / "app/server.js").write_text("truncated upload")
                result = self.activate(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((self.home / "current").resolve(), self.old)
                self.assertNotIn(
                    "stop:old", self.events.read_text() if self.events.exists() else ""
                )
                self.assertFalse((self.home / "run/deploy.lock").exists())
                release.write(self.new)

    def test_failed_start_or_application_readiness_rolls_back(self) -> None:
        for failure in ("start", "ready"):
            with self.subTest(failure=failure):
                self.events.unlink(missing_ok=True)
                result = self.activate(failure)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual((self.home / "current").resolve(), self.old)
                self.assertIn("stop:new\nstart:old\n", self.events.read_text())
                self.assertFalse((self.home / "run/deploy.lock").exists())

    def test_open_port_or_wrong_release_is_not_ready(self) -> None:
        html = (self.new / "dist/index.html").read_bytes()
        for client, api in (
            (b"other client", {"boards": []}),
            (html, {"error": "database offline"}),
            (html, []),
        ):
            with (
                patch(
                    "release.urllib.request.urlopen",
                    side_effect=[
                        io.BytesIO(client),
                        io.BytesIO(json.dumps(api).encode()),
                    ],
                ),
                self.assertRaises(ValueError),
            ):
                release.ready(self.new, "http://fixture")
        with patch(
            "release.urllib.request.urlopen",
            side_effect=[
                io.BytesIO(html),
                io.BytesIO(b'{"boards": []}'),
            ],
        ):
            release.ready(self.new, "http://fixture")

    def test_concurrent_activation_is_rejected(self) -> None:
        (self.home / "run/deploy.lock").mkdir(parents=True)
        result = self.activate()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.events.exists())
        self.assertTrue((self.home / "run/deploy.lock").exists())
