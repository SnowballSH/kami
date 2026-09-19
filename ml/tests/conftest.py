import json
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from tiny_model import TINY_LABELS, TINY_TEMPERATURE, build_tiny_model

from render import render_source_sha256
from sidecar import create_server


@pytest.fixture(scope="session")
def tiny_artifacts(tmp_path_factory: pytest.TempPathFactory) -> Path:
    artifacts_dir = tmp_path_factory.mktemp("artifacts") / "tiny"
    artifacts_dir.mkdir()
    build_tiny_model(artifacts_dir / "model.onnx")
    (artifacts_dir / "labels.json").write_text(json.dumps(TINY_LABELS))
    (artifacts_dir / "preprocess.json").write_text(
        json.dumps({"temperature": TINY_TEMPERATURE, "renderSha256": render_source_sha256()})
    )
    return artifacts_dir


@pytest.fixture(scope="session")
def sidecar_url(tiny_artifacts: Path) -> Iterator[str]:
    server = create_server(tiny_artifacts, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()
    thread.join()
