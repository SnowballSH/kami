"""ONNX Runtime without its telemetry uploader.

Imported anywhere onnxruntime is needed. The uploader starts a background HTTP thread at import that
aborts the process on macOS (a recursive_mutex failure in its event dispatch killed DataLoader
workers mid-training), and it phones home from every server running the sidecar. The variable must
be set before the library loads, which is why this module exists.
"""

import os

os.environ.setdefault("ORT_DISABLE_TELEMETRY", "1")

import onnxruntime as ort

__all__ = ["ort"]
