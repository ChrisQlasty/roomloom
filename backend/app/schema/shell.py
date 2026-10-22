"""The building shell: rooms, walls, openings and transitions. Produced only by the importer."""

import math
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.schema.common import (
    MaterialRef,
    Polygon,
    PositiveFloat,
    RoomId,
    SchemaModel,
    Tag,
    Vec2,
)
from app.schema.ids import id_pattern

MAX_CEILING_HEIGHT = 8.0
DEFAULT_CEILING_HEIGHT = 2.6


class Surfaces(SchemaModel):
    """Materials of a room's inner surfaces."""

    floor: MaterialRef = Field("mat_floor_default", description="Floor material.")
    ceiling: MaterialRef = Field("mat_ceiling_default", description="Ceiling material.")
    walls: MaterialRef = Field(
        "mat_wall_default",
        description="Material of every wall face looking into this room, unless overridden.",
    )


class Room(SchemaModel):
    """One room of the shell. Geometry is locked; name, tags, notes, surfaces and ceiling edit."""

    id: RoomId = Field(description="Room id, prefix 'r_'.")
    name: str = Field(min_length=1, description="Display name, e.g. 'Room 3A'.")
    tags: list[Tag] = Field(default_factory=list, description="Free-form tags for selectors.")
    polygon: Polygon = Field(description="Floor outline in plan coordinates.")
    floor_level: float = Field(
        0.0, ge=-5, le=5, description="Floor height in metres; 0 is the entrance level."
    )
    ceiling_height: float = Field(
        DEFAULT_CEILING_HEIGHT,
        gt=0,
        le=MAX_CEILING_HEIGHT,
        description=(
            "Ceiling height above this room's floor, in metres. At most 8 m and at least the top "
            "of every opening in the room's walls + 0.05 m."
        ),
    )
    notes: list[str] = Field(default_factory=list, description="Notes, e.g. from Miro stickies.")
    surfaces: Surfaces = Field(default_factory=Surfaces, description="Surface materials.")


class Opening(SchemaModel):
    """A door, window or open passage inside a wall."""

    id: Annotated[str, Field(pattern=id_pattern("opening"))] = Field(
        description="Opening id, prefix 'op_'."
    )
    kind: Literal["door", "window", "passage"] = Field(description="What fills the hole.")
    offset: float = Field(
        ge=0, description="Distance in metres along the wall from end a to the near edge."
    )
    width: PositiveFloat = Field(description="Width along the wall in metres.")
    height: PositiveFloat = Field(description="Height of the hole in metres.")
    sill: float = Field(
        0.0,
        ge=0,
        description=(
            "Height of the bottom edge in metres, measured from the higher floor of the rooms "
            "on either side of the wall (the threshold level)."
        ),
    )


class FaceOverrides(SchemaModel):
    """Per-face material overrides of one wall; unset faces use the facing room's walls."""

    left: MaterialRef | None = Field(None, description="Face on the left of a→b, seen from above.")
    right: MaterialRef | None = Field(
        None, description="Face on the right of a→b, seen from above."
    )


class Wall(SchemaModel):
    """A straight wall segment from a to b. 'Left' and 'right' are as seen from above."""

    id: Annotated[str, Field(pattern=id_pattern("wall"))] = Field(
        description="Wall id, prefix 'w_'."
    )
    a: Vec2 = Field(description="Start point of the centre line.")
    b: Vec2 = Field(description="End point of the centre line.")
    thickness: PositiveFloat = Field(description="Wall thickness in metres.")
    kind: Literal["exterior", "interior"] = Field(
        description="Exterior walls have one room, interior walls two."
    )
    left_room_id: RoomId | None = Field(None, description="Room on the left of a→b.")
    right_room_id: RoomId | None = Field(None, description="Room on the right of a→b.")
    openings: list[Opening] = Field(default_factory=list, description="Holes in this wall.")
    face_overrides: FaceOverrides = Field(
        default_factory=FaceOverrides, description="Optional per-face materials."
    )

    @property
    def length(self) -> float:
        """Centre-line length in metres."""
        return math.dist(self.a, self.b)

    @property
    def room_ids(self) -> list[str]:
        """Ids of the rooms this wall bounds (one or two)."""
        return [r for r in (self.left_room_id, self.right_room_id) if r is not None]

    @model_validator(mode="after")
    def _positive_length(self) -> "Wall":
        if self.length <= 0:
            raise ValueError(f"wall {self.id} has zero length")
        return self


class Transition(SchemaModel):
    """Steps at an opening between floors at different levels."""

    id: Annotated[str, Field(pattern=id_pattern("transition"))] = Field(
        description="Transition id, prefix 'tr_'."
    )
    opening_id: str = Field(description="Opening the steps lead through.")
    steps: int = Field(ge=1, description="Number of steps.")
    rise_total: PositiveFloat = Field(
        description="Total height climbed in metres; equals the floor level difference."
    )
    host_room_id: RoomId = Field(description="Room the steps are built in.")


class WallThickness(SchemaModel):
    """Default wall thicknesses used by the importer."""

    exterior: PositiveFloat = Field(0.30, description="Exterior wall thickness in metres.")
    interior: PositiveFloat = Field(0.12, description="Interior wall thickness in metres.")


class Shell(SchemaModel):
    """The locked building shell. Only room metadata and ceiling heights may change after import."""

    outline: Polygon = Field(description="Building footprint: the union of all rooms.")
    default_ceiling_height: float = Field(
        DEFAULT_CEILING_HEIGHT, gt=0, le=MAX_CEILING_HEIGHT, description="Ceiling for new rooms."
    )
    wall_thickness: WallThickness = Field(
        default_factory=WallThickness, description="Default wall thicknesses."
    )
    facade_material: MaterialRef = Field(
        "mat_facade_default", description="Material of every exterior wall face."
    )
    rooms: list[Room] = Field(min_length=1, description="All rooms.")
    walls: list[Wall] = Field(default_factory=list, description="All walls.")
    transitions: list[Transition] = Field(default_factory=list, description="All step flights.")
