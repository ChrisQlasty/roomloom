"""Placed objects: primitive shapes or prefab references, with a transform and materials.

Local frame of every primitive: origin at the bottom centre (so position.y is the height of the
surface it stands on), +Y up, front facing local -Z (north when yaw is 0).
"""

from typing import Annotated, Literal

from pydantic import Field

from app.schema.common import (
    MaterialRef,
    PositiveFloat,
    Profile,
    RoomId,
    SchemaModel,
    Tag,
    Vec3,
)
from app.schema.ids import id_pattern


class Box(SchemaModel):
    """Axis-aligned box standing on its base."""

    type: Literal["box"] = "box"
    size: tuple[PositiveFloat, PositiveFloat, PositiveFloat] = Field(
        description="[width x, height y, depth z] in metres."
    )


class Cylinder(SchemaModel):
    """Upright cylinder standing on its base."""

    type: Literal["cylinder"] = "cylinder"
    radius: PositiveFloat = Field(description="Radius in metres.")
    height: PositiveFloat = Field(description="Height in metres.")


class Sphere(SchemaModel):
    """Sphere resting on its lowest point."""

    type: Literal["sphere"] = "sphere"
    radius: PositiveFloat = Field(description="Radius in metres.")


class Cone(SchemaModel):
    """Upright cone with its base on the ground and apex up."""

    type: Literal["cone"] = "cone"
    radius: PositiveFloat = Field(description="Base radius in metres.")
    height: PositiveFloat = Field(description="Height in metres.")


class Pipe(SchemaModel):
    """Tube along a polyline of local points."""

    type: Literal["pipe"] = "pipe"
    path: list[Vec3] = Field(min_length=2, description="Centre-line points in local metres.")
    radius: PositiveFloat = Field(description="Tube radius in metres.")
    elbows: bool = Field(True, description="Round the bends instead of mitring them.")


class Extrusion(SchemaModel):
    """A 2D profile in the local x/y plane, extruded along z, centred on z = 0."""

    type: Literal["extrusion"] = "extrusion"
    profile: Profile = Field(description="Outline in the local x/y plane; y = 0 is the ground.")
    depth: PositiveFloat = Field(description="Extrusion length along local z in metres.")


class Panel(SchemaModel):
    """Thin flat vertical panel, front facing local -Z."""

    type: Literal["panel"] = "panel"
    width: PositiveFloat = Field(description="Width along local x in metres.")
    height: PositiveFloat = Field(description="Height along local y in metres.")


class PrefabRef(SchemaModel):
    """Reference to a parametric prefab from the prefab registry."""

    type: Literal["prefab"] = "prefab"
    prefab: str = Field(min_length=1, description="Prefab name, e.g. 'desk'.")
    params: dict[str, float | int | bool | str] = Field(
        default_factory=dict, description="Prefab parameters; unset ones use prefab defaults."
    )


Geometry = Annotated[
    Box | Cylinder | Sphere | Cone | Pipe | Extrusion | Panel | PrefabRef,
    Field(discriminator="type"),
]


class Transform(SchemaModel):
    """Placement in world space."""

    position: Vec3 = Field(description="World position of the local origin, in metres.")
    rotation_deg: Vec3 = Field(
        (0.0, 0.0, 0.0),
        description="Rotation [rx, ry, rz] in degrees; ry is yaw, 0 faces north, clockwise.",
    )
    scale: tuple[PositiveFloat, PositiveFloat, PositiveFloat] = Field(
        (1.0, 1.0, 1.0), description="Scale factors [sx, sy, sz]."
    )


class SceneObject(SchemaModel):
    """An object placed in the scene."""

    id: Annotated[str, Field(pattern=id_pattern("object"))] = Field(
        description="Object id, prefix 'obj_'."
    )
    name: str = Field(min_length=1, description="Display name.")
    room_id: RoomId | None = Field(None, description="Room the object belongs to, if any.")
    tags: list[Tag] = Field(default_factory=list, description="Free-form tags for selectors.")
    geometry: Geometry = Field(description="Primitive shape or prefab reference.")
    transform: Transform = Field(description="World placement.")
    materials: dict[str, MaterialRef] = Field(
        default_factory=dict,
        description="Material per slot: 'main' for primitives, prefab-defined slots otherwise.",
    )
    created_by: Literal["agent", "user", "import"] = Field(description="Who created it.")
