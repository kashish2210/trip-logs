"""Best-effort access to the persistent geo cache.

A cache is an optimisation, never a dependency: if the backing store is
missing, locked, or corrupt, the caller should still get an answer. Every
operation here therefore swallows backend errors and degrades to a miss.
"""

from __future__ import annotations

import logging
from typing import Any

from django.core.cache import caches
from django.core.cache.backends.base import InvalidCacheBackendError

log = logging.getLogger(__name__)


def _backend():
    try:
        return caches["geo"]
    except InvalidCacheBackendError:
        return caches["default"]


def cache_get(key: str) -> Any | None:
    try:
        return _backend().get(key)
    except Exception as exc:  # locked file, unreadable pickle, missing dir
        log.debug("Cache read failed for %s: %s", key, exc)
        return None


def cache_set(key: str, value: Any, ttl: int) -> None:
    try:
        _backend().set(key, value, ttl)
    except Exception as exc:
        log.debug("Cache write failed for %s: %s", key, exc)
