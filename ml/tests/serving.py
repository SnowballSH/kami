"""A sidecar over an artefact directory, on a free port, for as long as a test needs it."""

import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sidecar import create_server


@contextmanager
def serving(artifacts_dir: Path) -> Iterator[str]:
    server = create_server(artifacts_dir, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
