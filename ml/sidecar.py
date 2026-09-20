"""Kami's Eye sidecar: the HTTP routes of ml/CONTRACT.md over a trained artefact directory."""

from __future__ import annotations

import json
import logging
import math
import os
import time
from collections.abc import Callable
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from artifacts import validate_bundle
from completion import SketchCompleter
from exemplar_set import load_exemplars_of_model
from recognizer import DEFAULT_TOP, SketchRecognizer
from render import Point

HOST = "127.0.0.1"
DEFAULT_PORT = 8790
DEFAULT_MODEL_DIR = Path(__file__).parent / "artifacts" / "kami-eye"
PORT_ENV = "KAMI_EYE_PORT"
MODEL_ENV = "KAMI_EYE_MODEL"
MAX_BODY_BYTES = 4_000_000
MAX_POINTS = 50_000
MAX_TOP = 1000
MAX_NAME_LENGTH = 200
MAX_COORDINATE = 1e9
WARM_UP_STROKES: list[list[Point]] = [[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]]

Answer = tuple[HTTPStatus, dict[str, object]]

log = logging.getLogger("kami-eye")


class BadRequest(ValueError):
    pass


def parse_strokes(payload: object) -> list[list[Point]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("strokes"), list):
        raise BadRequest("body must be an object with a 'strokes' array")
    strokes: list[list[Point]] = []
    for stroke in payload["strokes"]:
        if not isinstance(stroke, list):
            raise BadRequest("every stroke must be an array of {x, y} points")
        strokes.append([_parse_point(point) for point in stroke])
    total = sum(len(stroke) for stroke in strokes)
    if total == 0:
        raise BadRequest("the drawing has no points")
    if total > MAX_POINTS:
        raise BadRequest(f"the drawing has more than {MAX_POINTS} points")
    return strokes


def _parse_point(point: object) -> Point:
    if not isinstance(point, dict):
        raise BadRequest("every point must be an object {x, y}")
    return _parse_coordinate(point.get("x")), _parse_coordinate(point.get("y"))


def _parse_coordinate(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise BadRequest("point coordinates must be finite numbers")
    if abs(value) > MAX_COORDINATE:
        raise BadRequest(f"point coordinates must be within +-{MAX_COORDINATE:g}")
    return float(value)


def parse_top(payload: dict[str, object]) -> int:
    top = payload.get("top", DEFAULT_TOP)
    if not isinstance(top, int) or isinstance(top, bool) or not 1 <= top <= MAX_TOP:
        raise BadRequest(f"'top' must be an integer from 1 to {MAX_TOP}")
    return top


def parse_partial(payload: dict[str, object]) -> bool:
    partial = payload.get("partial", False)
    if not isinstance(partial, bool):
        raise BadRequest("'partial' must be a boolean")
    return partial


def parse_name(payload: dict[str, object]) -> str | None:
    name = payload.get("name")
    if name is None:
        return None
    if not isinstance(name, str) or len(name) > MAX_NAME_LENGTH:
        raise BadRequest(f"'name' must be a string of at most {MAX_NAME_LENGTH} characters")
    return name


def make_handler(
    recognizer: SketchRecognizer,
    completer: SketchCompleter | None = None,
    *,
    artifact_id: str,
) -> type[BaseHTTPRequestHandler]:
    class SidecarHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        disable_nagle_algorithm = True

        def do_GET(self) -> None:
            self._answer(self._get)

        def do_POST(self) -> None:
            self._answer(self._post)

        def _get(self) -> Answer:
            if self.path != "/health":
                return HTTPStatus.NOT_FOUND, {"error": f"no route GET {self.path}"}
            return HTTPStatus.OK, {
                "ok": True,
                "classes": len(recognizer.labels),
                "model": recognizer.name,
                "renderMatches": recognizer.render_matches,
                "exemplars": completer.exemplar_count if completer is not None else 0,
                "artifactId": artifact_id,
            }

        def _post(self) -> Answer:
            if self.path not in ("/recognize", "/embed", "/complete"):
                return HTTPStatus.NOT_FOUND, {"error": f"no route POST {self.path}"}
            payload = self._read_json()
            strokes = parse_strokes(payload)
            if self.path == "/embed":
                return HTTPStatus.OK, {"embedding": recognizer.embed(strokes)}
            if self.path == "/complete":
                return self._complete(strokes, parse_name(payload))
            parse_partial(payload)
            recognition = recognizer.recognize(strokes, parse_top(payload))
            return HTTPStatus.OK, {"labels": recognition.labels, "probs": recognition.probs}

        def _complete(self, strokes: list[list[Point]], name: str | None) -> Answer:
            if completer is None:
                return HTTPStatus.NOT_FOUND, {"error": f"{recognizer.name} has no exemplar set"}
            completion = completer.complete(strokes, name)
            if completion is None:
                return HTTPStatus.NOT_FOUND, {"error": "no exemplar to finish this drawing with"}
            return HTTPStatus.OK, completion.to_json()

        def _read_json(self) -> dict[str, object]:
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError as error:
                raise BadRequest("Content-Length is required") from error
            if not 0 < length <= MAX_BODY_BYTES:
                raise BadRequest(f"body must be 1 to {MAX_BODY_BYTES} bytes")
            try:
                payload = json.loads(self.rfile.read(length))
            except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as error:
                raise BadRequest("body is not valid JSON") from error
            if not isinstance(payload, dict):
                raise BadRequest("body must be a JSON object")
            return payload

        def _answer(self, route: Callable[[], Answer]) -> None:
            started = time.perf_counter()
            try:
                status, body = route()
            except BadRequest as error:
                status, body = HTTPStatus.BAD_REQUEST, {"error": str(error)}
            except Exception as error:
                log.exception("unhandled error")
                status, body = HTTPStatus.INTERNAL_SERVER_ERROR, {"error": type(error).__name__}
            if status != HTTPStatus.OK:
                self.close_connection = True
            encoded = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(encoded)
            elapsed_ms = (time.perf_counter() - started) * 1000
            log.info("%s %s %d %.1f ms", self.command, self.path, status, elapsed_ms)

        def log_message(self, format: str, *args: object) -> None:
            return

    return SidecarHandler


def load_completer(recognizer: SketchRecognizer, model_dir: Path) -> SketchCompleter | None:
    """Completion is an extra: without a sound exemplar set the sidecar still recognises."""
    started = time.perf_counter()
    try:
        exemplars = load_exemplars_of_model(model_dir)
        completer = SketchCompleter(recognizer, exemplars) if exemplars is not None else None
    except (ValueError, OSError) as error:
        log.warning("serving without /complete: %s", error)
        return None
    if completer is None:
        log.info("%s has no exemplar set: /complete answers 404", recognizer.name)
        return None
    load_ms = (time.perf_counter() - started) * 1000
    log.info("%d exemplars loaded in %.0f ms", completer.exemplar_count, load_ms)
    return completer


def create_server(model_dir: Path, port: int) -> ThreadingHTTPServer:
    model_dir = model_dir.resolve(strict=True)
    artifact_id = validate_bundle(model_dir)
    recognizer = SketchRecognizer(model_dir)
    completer = load_completer(recognizer, model_dir)
    started = time.perf_counter()
    recognizer.recognize(WARM_UP_STROKES)
    recognizer.embed(WARM_UP_STROKES)
    warm_up_ms = (time.perf_counter() - started) * 1000
    log.info(
        "%s: %d classes, warmed up in %.0f ms", recognizer.name, len(recognizer.labels), warm_up_ms
    )
    return ThreadingHTTPServer(
        (HOST, port), make_handler(recognizer, completer, artifact_id=artifact_id)
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    model_dir = Path(os.environ.get(MODEL_ENV, DEFAULT_MODEL_DIR))
    port = int(os.environ.get(PORT_ENV, DEFAULT_PORT))
    server = create_server(model_dir, port)
    log.info("listening on http://%s:%d", HOST, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
