"""Read and write scene.json with stable formatting and atomic replacement."""

import json
import os
import re
import tempfile
from pathlib import Path

from app.schema.scene import Scene

_NUMBER = r"-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?"
_NUMBER_ARRAY = re.compile(rf"\[\s*({_NUMBER}(?:,\s*{_NUMBER})*)\s*\]")


def _inline_number_arrays(text: str) -> str:
    """Put number-only arrays (points, vectors) on one line: `[1.0, 2.0]`."""
    return _NUMBER_ARRAY.sub(lambda m: "[" + re.sub(r",\s*", ", ", m.group(1)) + "]", text)


def dump_scene(scene: Scene) -> str:
    """Serialise a scene as stable, readable JSON: field order, 2-space indent, inline vectors."""
    text = json.dumps(scene.model_dump(mode="json"), indent=2, ensure_ascii=False)
    return _inline_number_arrays(text) + "\n"


def load_scene(path: Path) -> Scene:
    """Load and validate a scene file."""
    return Scene.model_validate_json(path.read_bytes())


def save_scene(scene: Scene, path: Path) -> None:
    """Write a scene atomically: a temp file in the same folder, fsync, then rename over `path`."""
    data = dump_scene(scene).encode()
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
