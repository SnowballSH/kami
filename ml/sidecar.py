"""Kami's sidecar, the HTTP routes of ml/CONTRACT.md: Kami's Eye over a trained artefact directory
and the handwriting reader over its pinned bundle. Either may be absent; the other still serves."""

from __future__ import annotations

import json
import logging
import math
import os
import signal
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Protocol

from artifacts import validate_bundle
from completion import SketchCompleter
from exemplar_set import load_exemplars_of_model
from handwriting.reader import HandwritingReader
from morph import DEFAULT_FIRMNESS
from recognizer import DEFAULT_TOP, SketchRecognizer
from render import Point

HOST = "127.0.0.1"
DEFAULT_PORT = 8790
DEFAULT_MODEL_DIR = Path(__file__).parent / "artifacts" / "kami-eye"
DEFAULT_HANDWRITING_DIR = Path(__file__).parent / "models" / "handwriting"
HOST_ENV = "KAMI_EYE_HOST"
PORT_ENV = "KAMI_EYE_PORT"
MODEL_ENV = "KAMI_EYE_MODEL"
THREADS_ENV = "KAMI_EYE_THREADS"
HANDWRITING_ENV = "KAMI_HANDWRITING_MODEL"
PARENT_ENV = "KAMI_SIDECAR_PARENT_PID"
MAX_BODY_BYTES = 262_144
MAX_STROKES = 256
MAX_POINTS_PER_STROKE = 1024
MAX_POINTS = 2048
MAX_TOP = 1000
MAX_NAME_LENGTH = 80
MAX_COORDINATE = 1e9
WARM_UP_STROKES: list[list[Point]] = [[(0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)]]
WARM_UP_WRITING: list[list[Point]] = [
    [(0.0, 0.0), (0.0, 40.0)],
    [(0.0, 20.0), (20.0, 20.0)],
    [(20.0, 0.0), (20.0, 40.0)],
    [(32.0, 0.0), (48.0, 0.0)],
    [(40.0, 0.0), (40.0, 40.0)],
    [(32.0, 40.0), (48.0, 40.0)],
]
EYE_ROUTES = ("/recognize", "/embed", "/complete")
READ_ROUTE = "/read"

Answer = tuple[HTTPStatus, dict[str, object]]

log = logging.getLogger("kami-eye")


class BadRequest(ValueError):
    pass


class ReadsHandwriting(Protocol):
    name: str

    def read(self, strokes: list[list[Point]]) -> str | None: ...


@dataclass(frozen=True, slots=True)
class Eye:
    """A validated Kami's Eye: its recogniser, its exemplar set if it has one, its artefact id."""

    recognizer: SketchRecognizer
    completer: SketchCompleter | None
    artifact_id: str


def _positive_int(env: Mapping[str, str], name: str) -> int | None:
    raw = env.get(name, "").strip()
    if raw == "":
        return None
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer, not {raw!r}") from error
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, not {raw!r}")
    return value


@dataclass(frozen=True)
class SidecarSettings:
    """Where the sidecar listens and what it serves; `threads` None leaves ORT its default."""

    model_dir: Path = DEFAULT_MODEL_DIR
    host: str = HOST
    port: int = DEFAULT_PORT
    threads: int | None = None
    handwriting_dir: Path = DEFAULT_HANDWRITING_DIR
    parent_pid: int | None = None

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> SidecarSettings:
        return cls(
            model_dir=Path(env.get(MODEL_ENV, "").strip() or DEFAULT_MODEL_DIR),
            host=env.get(HOST_ENV, "").strip() or HOST,
            port=_positive_int(env, PORT_ENV) or DEFAULT_PORT,
            threads=_positive_int(env, THREADS_ENV),
            handwriting_dir=Path(env.get(HANDWRITING_ENV, "").strip() or DEFAULT_HANDWRITING_DIR),
            parent_pid=_positive_int(env, PARENT_ENV),
        )


def parse_strokes(payload: object) -> list[list[Point]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("strokes"), list):
        raise BadRequest("body must be an object with a 'strokes' array")
    raw_strokes = payload["strokes"]
    if len(raw_strokes) > MAX_STROKES:
        raise BadRequest(f"the drawing has more than {MAX_STROKES} strokes")
    total = 0
    for stroke in raw_strokes:
        if not isinstance(stroke, list):
            raise BadRequest("every stroke must be an array of {x, y} points")
        if len(stroke) > MAX_POINTS_PER_STROKE:
            raise BadRequest(f"a stroke has more than {MAX_POINTS_PER_STROKE} points")
        total += len(stroke)
        if total > MAX_POINTS:
            raise BadRequest(f"the drawing has more than {MAX_POINTS} points")
    if total == 0:
        raise BadRequest("the drawing has no points")
    return [[_parse_point(point) for point in stroke] for stroke in raw_strokes]


def _parse_point(point: object) -> Point:
    if not isinstance(point, dict):
        raise BadRequest("every point must be an object {x, y}")
    return _parse_coordinate(point.get("x")), _parse_coordinate(point.get("y"))


def _parse_coordinate(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise BadRequest("point coordinates must be finite numbers")
    if abs(value) > MAX_COORDINATE:
        raise BadRequest(f"point coordinates must be within +-{MAX_COORDINATE:g}")
    if not math.isfinite(value):
        raise BadRequest("point coordinates must be finite numbers")
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
    if (
        not isinstance(name, str)
        or len(name.encode("utf-16-le", errors="surrogatepass")) // 2 > MAX_NAME_LENGTH
    ):
        raise BadRequest(f"'name' must be a string of at most {MAX_NAME_LENGTH} characters")
    return name


def parse_strength(payload: dict[str, object]) -> float:
    strength = payload.get("strength", DEFAULT_FIRMNESS)
    if isinstance(strength, bool) or not isinstance(strength, int | float):
        raise BadRequest("'strength' must be a number from 0 to 1")
    if not math.isfinite(strength) or not 0.0 <= strength <= 1.0:
        raise BadRequest("'strength' must be a number from 0 to 1")
    return float(strength)


def parse_body_length(value: str | None) -> int:
    try:
        length = int(value or "")
    except ValueError as error:
        raise BadRequest("Content-Length is required") from error
    if not 0 < length <= MAX_BODY_BYTES:
        raise BadRequest(f"body must be 1 to {MAX_BODY_BYTES} bytes")
    return length


def make_handler(
    eye: Eye | None, reader: ReadsHandwriting | None = None
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
            health: dict[str, object] = {
                "ok": True,
                "capabilities": {"eye": eye is not None, "handwriting": reader is not None},
            }
            if eye is not None:
                health |= {
                    "classes": len(eye.recognizer.labels),
                    "model": eye.recognizer.name,
                    "renderMatches": eye.recognizer.render_matches,
                    "exemplars": eye.completer.exemplar_count if eye.completer is not None else 0,
                    "artifactId": eye.artifact_id,
                }
            if reader is not None:
                health["handwriting"] = {"model": reader.name}
            return HTTPStatus.OK, health

        def _post(self) -> Answer:
            if self.path == READ_ROUTE:
                return self._read()
            if self.path not in EYE_ROUTES:
                return HTTPStatus.NOT_FOUND, {"error": f"no route POST {self.path}"}
            if eye is None:
                return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "no Kami's Eye model is loaded"}
            payload = self._read_json()
            strokes = parse_strokes(payload)
            if self.path == "/embed":
                return HTTPStatus.OK, {"embedding": eye.recognizer.embed(strokes)}
            if self.path == "/complete":
                return self._complete(eye, strokes, parse_name(payload), parse_strength(payload))
            partial = parse_partial(payload)
            recognition = eye.recognizer.recognize(strokes, parse_top(payload), partial=partial)
            answer: dict[str, object] = {"labels": recognition.labels, "probs": recognition.probs}
            if eye.recognizer.certain_above is not None:
                answer["certainAbove"] = eye.recognizer.certain_above.of(partial)
            return HTTPStatus.OK, answer

        def _read(self) -> Answer:
            if reader is None:
                return HTTPStatus.SERVICE_UNAVAILABLE, {"error": "no handwriting model is loaded"}
            return HTTPStatus.OK, {"text": reader.read(parse_strokes(self._read_json()))}

        def _complete(
            self, eye: Eye, strokes: list[list[Point]], name: str | None, strength: float
        ) -> Answer:
            if eye.completer is None:
                return HTTPStatus.NOT_FOUND, {"error": f"{eye.recognizer.name} has no exemplar set"}
            completion = eye.completer.complete(strokes, name, strength)
            if completion is None:
                return HTTPStatus.NOT_FOUND, {"error": "no exemplar to finish this drawing with"}
            return HTTPStatus.OK, completion.to_json()

        def _read_json(self) -> dict[str, object]:
            length = parse_body_length(self.headers.get("Content-Length"))
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
            try:
                self._send(status, json.dumps(body).encode())
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
                log.info("%s %s: the client left before the answer", self.command, self.path)
                return
            elapsed_ms = (time.perf_counter() - started) * 1000
            log.info("%s %s %d %.1f ms", self.command, self.path, status, elapsed_ms)

        def _send(self, status: HTTPStatus, encoded: bytes) -> None:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(encoded)

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


def load_eye(model_dir: Path, threads: int | None = None) -> Eye:
    model_dir = model_dir.resolve(strict=True)
    artifact_id = validate_bundle(model_dir)
    recognizer = SketchRecognizer(model_dir, threads=threads)
    completer = load_completer(recognizer, model_dir)
    started = time.perf_counter()
    recognizer.recognize(WARM_UP_STROKES)
    recognizer.embed(WARM_UP_STROKES)
    warm_up_ms = (time.perf_counter() - started) * 1000
    log.info(
        "%s: %d classes, warmed up in %.0f ms", recognizer.name, len(recognizer.labels), warm_up_ms
    )
    return Eye(recognizer, completer, artifact_id)


def load_reader(handwriting_dir: Path, threads: int | None = None) -> HandwritingReader:
    started = time.perf_counter()
    reader = HandwritingReader.load(handwriting_dir, threads)
    reader.read(WARM_UP_WRITING)
    ready_ms = (time.perf_counter() - started) * 1000
    log.info("handwriting: %s, ready in %.0f ms", reader.name, ready_ms)
    return reader


def serve(
    eye: Eye | None, reader: ReadsHandwriting | None, port: int, *, host: str = HOST
) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), make_handler(eye, reader))


def create_server(
    model_dir: Path | None,
    port: int,
    *,
    host: str = HOST,
    threads: int | None = None,
    handwriting_dir: Path | None = None,
) -> ThreadingHTTPServer:
    """`None` leaves a capability out; a directory that is given must hold a sound bundle."""
    eye = load_eye(model_dir, threads) if model_dir is not None else None
    reader = load_reader(handwriting_dir, threads) if handwriting_dir is not None else None
    return serve(eye, reader, port, host=host)


def present(directory: Path, what: str, variable: str) -> Path | None:
    if directory.exists():
        return directory
    log.warning("no %s at %s: serving without it (set %s)", what, directory, variable)
    return None


def interrupt_self() -> None:
    os.kill(os.getpid(), signal.SIGINT)


def exit_with_parent(
    parent_pid: int, on_orphaned: Callable[[], None] = interrupt_self, poll_s: float = 1.0
) -> threading.Thread:
    """A server that started the sidecar and died without stopping it takes the sidecar along."""

    def watch() -> None:
        while os.getppid() == parent_pid:
            time.sleep(poll_s)
        log.info("the server that started the sidecar is gone: stopping")
        on_orphaned()

    watcher = threading.Thread(target=watch, name="parent-watch", daemon=True)
    watcher.start()
    return watcher


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    settings = SidecarSettings.from_env()
    if settings.parent_pid is not None:
        exit_with_parent(settings.parent_pid)
    model_dir = present(settings.model_dir, "Kami's Eye model", MODEL_ENV)
    handwriting_dir = present(settings.handwriting_dir, "handwriting model", HANDWRITING_ENV)
    if model_dir is None and handwriting_dir is None:
        raise SystemExit(
            f"nothing to serve: mount an exported Kami's Eye at {settings.model_dir} "
            f"(ml/CONTRACT.md) or fetch the handwriting model into {settings.handwriting_dir} "
            "(python -m handwriting.fetch <directory>)"
        )
    server = create_server(
        model_dir,
        settings.port,
        host=settings.host,
        threads=settings.threads,
        handwriting_dir=handwriting_dir,
    )
    log.info("listening on http://%s:%d", *server.server_address[:2])
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("stopping")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
