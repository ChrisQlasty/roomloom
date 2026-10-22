"""Shared building blocks for the scene schema: base model, vectors, polygons, refs, tags."""

from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.geometry.polygon import normalise_polygon, require_ccw_polygon, validate_simple_ring
from app.schema.ids import id_pattern


def _round_mm(value: float) -> float:
    """Round to millimetres so stored coordinates stay readable; `+ 0.0` turns -0.0 into 0.0."""
    return round(value, 3) + 0.0


class SchemaModel(BaseModel):
    """Base for every scene model: unknown keys are errors, not silently dropped.

    Serialised output always contains every field, so the serialisation schema marks fields with
    defaults as required too.
    """

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


Coord = Annotated[float, AfterValidator(_round_mm)]
Vec2 = Annotated[tuple[Coord, Coord], Field(description="Plan point [x, y] in metres.")]
Vec3 = Annotated[
    tuple[Coord, Coord, Coord], Field(description="World vector [x, y, z] in metres, Y up.")
]
Polygon = Annotated[
    list[Vec2],
    Field(
        min_length=3,
        description=(
            "Closed simple polygon of plan points; the first point is not repeated. "
            "Stored counter-clockwise as seen from above (north up)."
        ),
    ),
    AfterValidator(normalise_polygon),
]
OrientedPolygon = Annotated[
    list[Vec2],
    Field(
        min_length=3,
        description=(
            "Closed simple polygon of plan points; the first point is not repeated. Must already "
            "be counter-clockwise as seen from above (north up): edges are referenced by index, "
            "edge i running from point i to point i+1."
        ),
    ),
    AfterValidator(require_ccw_polygon),
]
Profile = Annotated[
    list[Vec2],
    Field(min_length=3, description="Closed simple 2D outline [[x, y], ...] in local metres."),
    AfterValidator(validate_simple_ring),
]

PositiveFloat = Annotated[float, Field(gt=0)]

RoomId = Annotated[str, Field(pattern=id_pattern("room"))]
MaterialRef = Annotated[
    str, Field(pattern=id_pattern("material"), description="Id of a material in scene.materials.")
]
AssetRef = Annotated[
    str, Field(pattern=id_pattern("asset"), description="Id of an asset in scene.assets.")
]
Tag = Annotated[
    str,
    Field(
        pattern="^[a-z0-9]+(?:[_-][a-z0-9]+)*$",
        description="Lowercase free-form tag without '#', e.g. 'corridor' or 'ceiling_mounted'.",
    ),
]
