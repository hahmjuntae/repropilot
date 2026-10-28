# chunked() silently drops trailing items when the length is not a multiple of size

**batchkit version:** 0.3.1
**Python:** 3.12.4 (macOS 14)

I'm using `chunked` to send records to an API in batches of 100. Some records never reached the API. It looks like the last, smaller batch is dropped.

```python
>>> from batchkit import chunked
>>> chunked([1, 2, 3, 4, 5], 2)
[[1, 2], [3, 4]]
```

Expected `[[1, 2], [3, 4], [5]]`. The docstring says "The last chunk may be shorter than size", so I think this is a bug. Inputs shorter than `size` return `[]` too:

```python
>>> chunked([1, 2], 3)
[]
```

This silently loses data, which is pretty bad for a batching helper.
