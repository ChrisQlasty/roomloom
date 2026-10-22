"""Read and write scene.json with stable formatting and atomic replacement."""

import json
from pathlib import Path

from app.schema.scene import Scene
from app.store.atomic import write_atomic

_INDENT = "  "


def _is_number_array(value: object) -> bool:
    """True for a non-empty list of plain numbers (a point or vector)."""
    return (
        isinstance(value, list)
        and bool(value)
        and all(isinstance(v, int | float) and not isinstance(v, bool) for v in value)
    )


def _encode(value: object, depth: int) -> str:
    """JSON with a 2-space indent, except number arrays, which stay on one line: `[1.0, 2.0]`."""
    if _is_number_array(value):
        return json.dumps(value)
    pad, inner = _INDENT * depth, _INDENT * (depth + 1)
    if isinstance(value, dict) and value:
        items = (f"{inner}{_encode(k, 0)}: {_encode(v, depth + 1)}" for k, v in value.items())
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(value, list) and value:
        items = (f"{inner}{_encode(v, depth + 1)}" for v in value)
        return "[\n" + ",\n".join(items) + f"\n{pad}]"
    return json.dumps(value, ensure_ascii=False)


def dump_scene(scene: Scene) -> str:
    """Serialise a scene as stable, readable JSON: field order, 2-space indent, inline vectors."""
    return _encode(scene.model_dump(mode="json"), 0) + "\n"


def load_scene(path: Path) -> Scene:
    """Load and validate a scene file."""
    return Scene.model_validate_json(path.read_bytes())


def save_scene(scene: Scene, path: Path) -> None:
    """Write a scene atomically (see `write_atomic`).

    The scene is validated again first (models are mutable), so an invalid scene raises
    `ValidationError` and leaves the file untouched.
    """
    text = dump_scene(scene)
    Scene.model_validate_json(text)
    write_atomic(path, text.encode())
