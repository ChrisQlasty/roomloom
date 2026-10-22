"""Project metadata stored in projects/<slug>/project.json."""

from datetime import datetime

from pydantic import Field

from app.schema.common import SchemaModel, Vec3

SLUG_PATTERN = "^[a-z0-9]+(?:-[a-z0-9]+)*$"


class Spawn(SchemaModel):
    """Where the visitor starts when the project opens."""

    position: Vec3 = Field(description="Feet position in world metres.")
    yaw_deg: float = Field(0.0, ge=0, lt=360, description="View direction, 0 north, clockwise.")


class Project(SchemaModel):
    """One project: a building, its profile and how the agent should talk about it."""

    id: str = Field(min_length=1, description="Stable project id.")
    slug: str = Field(pattern=SLUG_PATTERN, description="Folder name and URL part.")
    name: str = Field(min_length=1, description="Display name.")
    description: str = Field("", description="Short description for the project picker.")
    profile_prompt: str = Field(
        "", description="Domain flavour for the agent, e.g. 'a 1980s primary school'."
    )
    language: str = Field("en", pattern="^[a-z]{2}$", description="ISO 639-1 language code.")
    created_at: datetime = Field(description="Creation time (UTC).")
    spawn: Spawn | None = Field(None, description="Start pose; defaults to the entrance.")
