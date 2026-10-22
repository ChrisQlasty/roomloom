"""History index entries stored one per line in projects/<slug>/history/index.jsonl."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schema.common import SchemaModel

ChangeSource = Literal["agent", "user", "import", "restore"]


class ChangeSetMeta(SchemaModel):
    """One committed change set; `history/<seq>.json.gz` holds the scene right after it."""

    seq: int = Field(ge=1, description="Position in the history, starting at 1.")
    ts: datetime = Field(description="Commit time (UTC).")
    source: ChangeSource = Field(description="Who made the change.")
    description: str = Field(min_length=1, description="What changed, e.g. 'Recolor 12 desks'.")
    label: str | None = Field(None, description="Optional checkpoint name set by the user.")
    scene_version: int = Field(ge=0, description="scene.version after this change set.")
