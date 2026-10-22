from pathlib import Path

from app.schema.export import ops_schema, scene_schema, to_json, write_schemas
from tests.paths import REPO_ROOT


def test_shared_schemas_are_up_to_date() -> None:
    """Fails when the Pydantic models changed but `make types` was not run."""
    shared = REPO_ROOT / "shared"
    assert (shared / "scene.schema.json").read_text(encoding="utf-8") == to_json(scene_schema())
    assert (shared / "ops.schema.json").read_text(encoding="utf-8") == to_json(ops_schema())


def test_generated_ts_has_banner() -> None:
    ts = (REPO_ROOT / "frontend" / "src" / "types" / "scene.ts").read_text(encoding="utf-8")
    assert ts.startswith("/* GENERATED — do not edit.")
    assert "export interface Scene {" in ts


def test_write_schemas_is_deterministic(tmp_path: Path) -> None:
    write_schemas(tmp_path)
    first = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    write_schemas(tmp_path)
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == first
    assert set(first) == {"scene.schema.json", "ops.schema.json"}
    assert first["scene.schema.json"] == to_json(scene_schema()).encode("utf-8")


def test_tuples_carry_ts_type_hints() -> None:
    text = to_json(scene_schema())
    assert '"tsType": "[number, number]"' in text
    assert '"tsType": "[number, number, number]"' in text
    assert '"title": "Wall"' in text
    assert '"title": "A"' not in text
