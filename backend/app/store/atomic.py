"""Crash-safe file writes: a reader sees the old contents or the new ones, never a mix."""

import os
import secrets
import stat
from pathlib import Path

_NEW_FILE_MODE = 0o666  # narrowed by the process umask, like any normally created file


def write_atomic(path: Path, data: bytes) -> None:
    """Write `data` to a temp file in the same folder, fsync, then rename it over `path`.

    An existing file keeps its permissions. On any error the temp file is removed and `path`
    is left untouched.
    """
    mode = stat.S_IMODE(path.stat().st_mode) if path.exists() else None
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, _NEW_FILE_MODE)
    try:
        with os.fdopen(fd, "wb") as f:
            if mode is not None:
                os.fchmod(f.fileno(), mode)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
