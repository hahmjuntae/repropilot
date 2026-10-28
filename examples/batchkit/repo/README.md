# batchkit

Small helpers for splitting and joining iterables.

```python
from batchkit import chunked, sliding_window, flatten

chunked([1, 2, 3, 4], 2)        # [[1, 2], [3, 4]]
sliding_window([1, 2, 3], 2)    # [(1, 2), (2, 3)]
flatten([[1, 2], [3]])          # [1, 2, 3]
```
