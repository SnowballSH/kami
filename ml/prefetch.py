"""Bounded read-ahead with scoped producer ownership."""

from __future__ import annotations

import queue
import threading
from collections.abc import Iterable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TypeVar

T = TypeVar("T")


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
