import threading
import time

import pytest

from prefetch import ordered_map, prefetch


def test_results_keep_the_order_of_the_items_whatever_finishes_first() -> None:
    def slow_when_small(item: int) -> int:
        time.sleep(0.002 * (10 - item))
        return item * item

    assert list(ordered_map(slow_when_small, range(10), workers=4)) == [n * n for n in range(10)]
    assert list(ordered_map(slow_when_small, range(3), workers=1)) == [0, 1, 4]
    assert list(ordered_map(slow_when_small, [], workers=4)) == []


def test_several_workers_really_run_at_once_and_never_more_than_a_window_ahead() -> None:
    running = 0
    most = 0
    started = 0
    lock = threading.Lock()

    def work(item: int) -> int:
        nonlocal running, most, started
        with lock:
            running += 1
            started += 1
            most = max(most, running)
        time.sleep(0.01)
        with lock:
            running -= 1
        return item

    results = ordered_map(work, range(40), workers=3)
    assert next(results) == 0
    time.sleep(0.05)
    assert started <= 2 * 3 + 1
    assert list(results) == list(range(1, 40))
    assert 1 < most <= 3


def test_a_failing_item_raises_where_it_stands_in_the_order() -> None:
    def work(item: int) -> int:
        if item == 2:
            raise OSError("injected read failure")
        return item

    results = ordered_map(work, range(5), workers=2)
    assert [next(results), next(results)] == [0, 1]
    with pytest.raises(OSError, match="injected"):
        next(results)
    with pytest.raises(ValueError):
        list(ordered_map(work, range(5), workers=0))


def test_it_feeds_the_read_ahead_thread() -> None:
    with prefetch(ordered_map(lambda item: item + 1, range(100), workers=4)) as batches:
        assert list(batches) == list(range(1, 101))
