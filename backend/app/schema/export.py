"""Write the shared JSON Schemas: `uv run python -m app.schema.export <shared dir>`."""

import json
import sys
from pathlib import Path
from typing import Any

from pydantic.json_schema import GenerateJsonSchema, JsonSchemaValue
from pydantic_core import core_schema

from app.schema.scene import Scene

_TS_SCALARS = {"number": "number", "integer": "number", "string": "string", "boolean": "boolean"}


class _SharedSchemaGenerator(GenerateJsonSchema):
    """Pydantic's generator, tuned for the shared schema and json-schema-to-typescript."""

    def field_title_should_be_set(self, schema: object) -> bool:
        """Omit per-field titles; they add noise and spurious named types in generated TS."""
        return False

    def tuple_schema(self, schema: core_schema.TupleSchema) -> JsonSchemaValue:
        """Add a `tsType` hint to fixed-length tuples; json2ts ignores 2020-12 `prefixItems`."""
        result = super().tuple_schema(schema)
        items = result.get("prefixItems")
        if items and "items" not in result and all(i.get("type") in _TS_SCALARS for i in items):
            result["tsType"] = "[" + ", ".join(_TS_SCALARS[i["type"]] for i in items) + "]"
        return result


def scene_schema() -> dict[str, Any]:
    """JSON Schema of a serialised Scene (what the API returns and scene.json holds)."""
    return Scene.model_json_schema(mode="serialization", schema_generator=_SharedSchemaGenerator)


def ops_schema() -> dict[str, Any]:
    """Placeholder until the ops engine exists."""
    return {
        "$comment": "Placeholder: generated from backend/app/ops once the ops engine exists.",
        "title": "Ops",
        "type": "object",
    }


def to_json(schema: dict[str, Any]) -> str:
    """Stable JSON text for a schema file."""
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def write_schemas(out_dir: Path) -> None:
    """Write scene.schema.json and ops.schema.json into `out_dir`."""
    (out_dir / "scene.schema.json").write_text(to_json(scene_schema()))
    (out_dir / "ops.schema.json").write_text(to_json(ops_schema()))


if __name__ == "__main__":
    write_schemas(Path(sys.argv[1]))
