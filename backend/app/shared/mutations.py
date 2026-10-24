"""Small helpers for durable, resource-scoped idempotent mutations."""
import hashlib
import json
import re
import threading
from contextlib import contextmanager
from weakref import WeakKeyDictionary

from fastapi import HTTPException
from app.db import current_runtime

_guard = threading.Lock()
_locks = WeakKeyDictionary()
_ID = re.compile(r'^[A-Za-z0-9_.:-]{1,128}$')


def mutation_id(value):
    if value is None:
        return None
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise HTTPException(400, 'mutation_id 格式错误')
    return value


def revision(value):
    if value is not None and (type(value) is not int or value < 0):
        raise HTTPException(400, 'revision 必须为非负整数')
    return value


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     allow_nan=False, separators=(',', ':')).encode()).hexdigest()


@contextmanager
def resource_lock(key):
    runtime = current_runtime()
    with _guard:
        locks = _locks.setdefault(runtime, {})
        lock = locks.setdefault(key, threading.RLock())
    with lock:
        yield


def run_locked(key, fn, *args, **kwargs):
    with resource_lock(key):
        return fn(*args, **kwargs)
