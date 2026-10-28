from collections import deque
from itertools import islice
from typing import Iterable, List, Tuple, TypeVar

T = TypeVar("T")


def chunked(iterable: Iterable[T], size: int) -> List[List[T]]:
    """Split an iterable into lists of ``size`` items.

    The last chunk may be shorter than ``size``.
    """
    if size < 1:
        raise ValueError("size must be >= 1")
    items = list(iterable)
    return [items[i : i + size] for i in range(0, len(items) - size + 1, size)]


def sliding_window(iterable: Iterable[T], size: int) -> List[Tuple[T, ...]]:
    """Return overlapping windows of ``size`` consecutive items."""
    if size < 1:
        raise ValueError("size must be >= 1")
    it = iter(iterable)
    window = deque(islice(it, size), maxlen=size)
    if len(window) < size:
        return []
    out = [tuple(window)]
    for item in it:
        window.append(item)
        out.append(tuple(window))
    return out


def flatten(nested: Iterable[Iterable[T]]) -> List[T]:
    """Flatten one level of nesting."""
    return [item for group in nested for item in group]
