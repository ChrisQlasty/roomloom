"""The scene document: the single source of truth for one project's building and contents."""

from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator

from app.schema.checks import scene_problems
from app.schema.common import (
    AssetRef,
    MaterialRef,
    PositiveFloat,
    RoomId,
    SchemaModel,
    Vec3,
)
from app.schema.ids import id_pattern
from app.schema.objects import SceneObject
from app.schema.shell import Shell


class Roof(SchemaModel):
    """The single roof over the building outline."""

    type: Literal["flat", "shed", "hip", "gable"] = Field(description="Roof shape.")
    pitch_deg: float = Field(
        0.0, ge=0, le=70, description="Slope in degrees (0-70); ignored for flat roofs."
    )
    overhang: float = Field(0.3, ge=0, description="Eaves overhang beyond the walls, in metres.")
    base_offset: float = Field(
        0.3, ge=0, description="Height of the eaves above the highest ceiling, in metres."
    )
    slope_direction_deg: float | None = Field(
        None,
        ge=0,
        lt=360,
        description="Shed roofs: downhill direction in degrees, 0 north, clockwise.",
    )
    gable_edges: list[int] | None = Field(
        None,
        description=(
            "Gable roofs: indices of shell.outline edges that become gable ends "
            "(edge i runs from point i to point i+1)."
        ),
    )
    material: MaterialRef = Field("mat_roof_default", description="Roof covering material.")
    fascia_material: MaterialRef | None = Field(None, description="Optional fascia material.")


class Material(SchemaModel):
    """A surface material; keyed by id in scene.materials."""

    name: str = Field(min_length=1, description="Display name.")
    color: str = Field(pattern="^#[0-9a-f]{6}$", description="Base colour, lowercase #rrggbb.")
    texture_asset: AssetRef | None = Field(None, description="Optional tileable texture asset.")
    tile_size_m: tuple[PositiveFloat, PositiveFloat] = Field(
        (1.0, 1.0), description="Real-world size [u, v] of one texture tile, in metres."
    )
    roughness: float = Field(0.8, ge=0, le=1, description="PBR roughness, 0-1.")
    metalness: float = Field(0.0, ge=0, le=1, description="PBR metalness, 0-1.")
    source: Literal["default", "user", "agent", "photo"] = Field(
        description="Origin; 'photo' means an AI texture generated from a photo."
    )


class Pin(SchemaModel):
    """A photo pinned at the pose it was taken from."""

    id: Annotated[str, Field(pattern=id_pattern("pin"))] = Field(
        description="Pin id, prefix 'pin_'."
    )
    asset_id: AssetRef = Field(description="The photo.")
    position: Vec3 = Field(description="Camera position in world metres.")
    yaw_deg: float = Field(ge=0, lt=360, description="View direction, 0 north, clockwise.")
    pitch_deg: float = Field(0.0, ge=-90, le=90, description="Up/down tilt in degrees.")
    fov_deg: float = Field(60.0, gt=0, lt=180, description="Vertical field of view in degrees.")
    caption: str = Field("", description="Caption shown with the photo.")
    author: str = Field("", description="Who took the photo.")
    year: int | None = Field(None, description="Year the photo was taken, if known.")
    placed: bool = Field(description="False until the pin is positioned in 3D.")


class Note(SchemaModel):
    """A building-level note."""

    id: Annotated[str, Field(pattern=id_pattern("note"))] = Field(
        description="Note id, prefix 'note_'."
    )
    text: str = Field(min_length=1, description="Note text.")
    room_ids: list[RoomId] = Field(
        default_factory=list, description="Rooms the note is about, e.g. rooms it mentions."
    )


class AssetMeta(SchemaModel):
    """A content-addressed file under the project's assets/ folder; keyed by id."""

    kind: Literal["photo", "texture", "thumbnail"] = Field(description="What the file is.")
    path: str = Field(
        pattern=r"^assets/[0-9a-f]{64}\.[a-z0-9]+$",
        description="Path relative to the project folder: assets/<sha256>.<ext>.",
    )
    sha256: str = Field(pattern="^[0-9a-f]{64}$", description="SHA-256 of the file contents.")
    w: int = Field(gt=0, description="Width in pixels.")
    h: int = Field(gt=0, description="Height in pixels.")
    original_name: str | None = Field(None, description="File name as uploaded.")


class Scene(SchemaModel):
    """The whole scene document stored in projects/<slug>/scene.json."""

    schema_version: Literal[1] = Field(description="Version of this document format.")
    version: int = Field(ge=0, description="Incremented by every change set.")
    shell: Shell = Field(description="Locked building shell.")
    roof: Roof = Field(description="The roof.")
    materials: dict[Annotated[str, Field(pattern=id_pattern("material"))], Material] = Field(
        description="All materials by id."
    )
    objects: list[SceneObject] = Field(default_factory=list, description="Placed objects.")
    pins: list[Pin] = Field(default_factory=list, description="Photo pins.")
    notes: list[Note] = Field(default_factory=list, description="Building-level notes.")
    assets: dict[Annotated[str, Field(pattern=id_pattern("asset"))], AssetMeta] = Field(
        default_factory=dict, description="All assets by id."
    )

    @field_validator("materials", "assets")
    @classmethod
    def _sort_by_id(cls, value: dict[str, object]) -> dict[str, object]:
        """Keep id-keyed maps sorted so saved files have a stable key order."""
        return dict(sorted(value.items()))

    @model_validator(mode="after")
    def _consistent(self) -> "Scene":
        problems = scene_problems(self)
        if problems:
            raise ValueError("; ".join(problems))
        return self
