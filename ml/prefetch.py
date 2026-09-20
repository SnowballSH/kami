"""Bounded read-ahead with scoped producer ownership."""

from __future__ import annotations

import queue
import threading
from collections import deque
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TypeVar

T = TypeVar("T")
R = TypeVar("R")


@dataclass(frozen=True)
class _Failure:
    error: BaseException


class _Done:
    pass


@contextmanager
def prefetch(source: Iterable[T], capacity: int = 6) -> Iterator[Iterator[T]]:
    if capacity < 1:
        raise ValueError("prefetch capacity must be positive")
    pending: queue.Queue[tuple[T] | _Failure | _Done] = queue.Queue(capacity)
    cancelled = threading.Event()

    def send(item: tuple[T] | _Failure | _Done) -> bool:
        while not cancelled.is_set():
            try:
                pending.put(item, timeout=0.05)
                return True
            except queue.Full:
                continue
        return False

    def produce() -> None:
        try:
            for item in source:
                if not send((item,)):
                    return
                if cancelled.is_set():
                    return
        except BaseException as error:
            send(_Failure(error))
        finally:
            send(_Done())

    def consume() -> Iterator[T]:
        while True:
            item = pending.get()
            if isinstance(item, _Done):
                return
            if isinstance(item, _Failure):
                raise item.error
            yield item[0]

    producer = threading.Thread(target=produce, name="kami-prefetch", daemon=True)
    producer.start()
    try:
        yield consume()
    finally:
        cancelled.set()
        producer.join()


def ordered_map(function: Callable[[T], R], items: Iterable[T], workers: int) -> Iterator[R]:
    """`map` on a thread pool, results in order, at most two items per worker in flight."""
    if workers < 1:
        raise ValueError("ordered_map needs at least one worker")
    if workers == 1:
        yield from map(function, items)
        return
    in_flight: deque[Future[R]] = deque()
    with ThreadPoolExecutor(workers, thread_name_prefix="kami-read") as pool:
        try:
            for item in items:
                in_flight.append(pool.submit(function, item))
                if len(in_flight) >= 2 * workers:
                    yield in_flight.popleft().result()
            while in_flight:
                yield in_flight.popleft().result()
        finally:
            for future in in_flight:
                future.cancel()
