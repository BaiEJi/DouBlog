"""Same-directory atomic configuration writes. Never publish partial JSON."""
import json
import os
from pathlib import Path
import tempfile


def atomic_write_text(path, text):
    target = Path(path).absolute()
    target.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary = tempfile.mkstemp(prefix=f'.{target.name}.', suffix='.tmp',
                                         dir=target.parent)
    try:
        with os.fdopen(handle, 'w', encoding='utf-8', newline='') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
        if os.name != 'nt':
            descriptor = os.open(target.parent, os.O_RDONLY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_write_json(path, value, indent=2):
    # Serialize first: invalid/non-finite values leave the previous file intact.
    atomic_write_text(path, json.dumps(value, ensure_ascii=False, allow_nan=False,
                                      indent=indent) + '\n')
