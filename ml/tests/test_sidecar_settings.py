import os
import threading
from pathlib import Path

import pytest
from test_sidecar import SQUARE, call

from sidecar import (
    DEFAULT_MODEL_DIR,
    DEFAULT_PORT,
    HOST,
    SidecarSettings,
    create_server,
    exit_with_parent,
)


def test_a_managed_sidecar_knows_its_parent() -> None:
    assert SidecarSettings.from_env({"KAMI_SIDECAR_PARENT_PID": "42"}).parent_pid == 42
    assert SidecarSettings.from_env({}).parent_pid is None


def test_a_sidecar_whose_parent_is_gone_stops() -> None:
    orphaned = threading.Event()
    watcher = exit_with_parent(os.getppid() + 1, orphaned.set, poll_s=0.01)
    assert orphaned.wait(timeout=5)
    watcher.join(timeout=5)


def test_a_sidecar_whose_parent_lives_keeps_serving() -> None:
    orphaned = threading.Event()
    exit_with_parent(os.getppid(), orphaned.set, poll_s=0.01)
    assert not orphaned.wait(timeout=0.1)


def test_defaults_are_loopback_and_leave_onnx_runtime_its_threads() -> None:
    settings = SidecarSettings.from_env({})
    assert settings == SidecarSettings(DEFAULT_MODEL_DIR, HOST, DEFAULT_PORT, None)


def test_every_setting_comes_from_the_environment() -> None:
    settings = SidecarSettings.from_env(
        {
            "KAMI_EYE_MODEL": "/models/kami-eye",
            "KAMI_EYE_HOST": "0.0.0.0",
            "KAMI_EYE_PORT": "9000",
            "KAMI_EYE_THREADS": " 2 ",
        }
    )
    assert settings == SidecarSettings(Path("/models/kami-eye"), "0.0.0.0", 9000, 2)


def test_blank_values_mean_unset() -> None:
    settings = SidecarSettings.from_env({"KAMI_EYE_HOST": "", "KAMI_EYE_THREADS": "  "})
    assert settings.host == HOST
    assert settings.threads is None


@pytest.mark.parametrize("threads", ["0", "-1", "one", "1.5"])
def test_threads_must_be_a_positive_integer(threads: str) -> None:
    with pytest.raises(ValueError, match="KAMI_EYE_THREADS"):
        SidecarSettings.from_env({"KAMI_EYE_THREADS": threads})


def test_server_binds_the_requested_host_and_recognises_with_one_thread(
    tiny_artifacts: Path,
) -> None:
    server = create_server(tiny_artifacts, port=0, host="0.0.0.0", threads=1)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert server.server_address[0] == "0.0.0.0"
        url = f"http://127.0.0.1:{server.server_address[1]}/recognize"
        status, body = call(url, {"strokes": SQUARE})
        assert status == 200
        assert len(body["labels"]) == 5
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
