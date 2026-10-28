import pytest

from batchkit import chunked, flatten, sliding_window


def test_chunked_even_split():
    assert chunked([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]


def test_chunked_rejects_zero_size():
    with pytest.raises(ValueError):
        chunked([1, 2], 0)


def test_sliding_window():
    assert sliding_window([1, 2, 3], 2) == [(1, 2), (2, 3)]


def test_sliding_window_short_input():
    assert sliding_window([1], 2) == []


def test_flatten():
    assert flatten([[1, 2], [3]]) == [1, 2, 3]
