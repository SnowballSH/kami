import threading
import unittest
from collections.abc import Callable, Iterator

from prefetch import prefetch


class PrefetchTests(unittest.TestCase):
    def bounded(self, operation: Callable[[], None]) -> None:
        errors: list[BaseException] = []

        def run() -> None:
            try:
                operation()
            except BaseException as error:
                errors.append(error)

        worker = threading.Thread(target=run, daemon=True)
        worker.start()
        worker.join(timeout=2)
        self.assertFalse(worker.is_alive(), "prefetch consumer did not terminate")
        if errors:
            raise errors[0]

    def test_read_error_reaches_consumer(self) -> None:
        failure = OSError("injected read failure")

        def read() -> Iterator[int]:
            yield 1
            raise failure

        def consume() -> None:
            with prefetch(read(), capacity=1) as batches:
                self.assertEqual(next(batches), 1)
                with self.assertRaises(OSError) as caught:
                    next(batches)
                self.assertIs(caught.exception, failure)

        self.bounded(consume)

    def test_break_cancels_full_queue_even_when_iterator_is_retained(self) -> None:
        blocked = threading.Event()
        producers: list[threading.Thread] = []

        def read() -> Iterator[int]:
            producers.append(threading.current_thread())
            for index in range(100):
                if index == 2:
                    blocked.set()
                yield index

        def consume() -> None:
            with prefetch(read(), capacity=1) as batches:
                for _ in batches:
                    self.assertTrue(blocked.wait(timeout=1))
                    break
            self.assertFalse(producers[0].is_alive())

        self.bounded(consume)

    def test_consumer_exception_joins_producer(self) -> None:
        producers: list[threading.Thread] = []

        def read() -> Iterator[int]:
            producers.append(threading.current_thread())
            yield from range(100)

        def consume() -> None:
            with (
                self.assertRaisesRegex(ValueError, "consumer"),
                prefetch(read(), capacity=1) as batches,
            ):
                next(batches)
                raise ValueError("consumer")
            self.assertFalse(producers[0].is_alive())

        self.bounded(consume)

    def test_empty_and_complete_sources(self) -> None:
        for source in ([], [1, 2, 3]):
            with prefetch(source, capacity=1) as batches:
                self.assertEqual(list(batches), source)
