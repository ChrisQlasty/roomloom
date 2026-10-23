"""Per-project `import_config.yaml`: which Miro colours mean what, and opening defaults."""

from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.importers.miro import MiroImportError

CONFIG_FILE = "import_config.yaml"


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _lower(values: list[str]) -> list[str]:
    return [v.strip().lower() for v in values]


class ShapeColors(_Model):
    """Rectangle fill colours (`#rrggbb`) reserved for openings and the notes area."""

    door: list[str] = ["#f24726", "#ff0000"]
    window: list[str] = ["#2d9bf0", "#12cdd4", "#6cd8fa"]
    passage: list[str] = ["#808080"]
    notes_area: list[str] = ["#8fd14f", "#0ca789", "#2dc75c"]

    @field_validator("*")
    @classmethod
    def _normalise(cls, value: list[str]) -> list[str]:
        return _lower(value)


class StickyColors(_Model):
    """Sticky-note colour names that carry level notes and room memories."""

    level: list[str] = ["orange"]
    memory: list[str] = ["yellow", "light_yellow"]

    @field_validator("*")
    @classmethod
    def _normalise(cls, value: list[str]) -> list[str]:
        return _lower(value)


class OpeningDefaults(_Model):
    """Size used when an opening's text gives no `h=` or `sill=`."""

    height: float = Field(gt=0)
    sill: float = Field(0.0, ge=0)


class Defaults(_Model):
    """Heights used when the board does not say otherwise, in metres."""

    ceiling_height: float = Field(2.6, gt=0, le=8)
    door: OpeningDefaults = OpeningDefaults(height=2.0)
    window: OpeningDefaults = OpeningDefaults(height=1.4, sill=0.9)
    passage: OpeningDefaults = OpeningDefaults(height=2.2)


class ImportConfig(_Model):
    """Everything the importer needs to interpret one board."""

    plan_frame: str = Field("Plan", min_length=1)
    notes_label: str = Field("Notes", min_length=1)
    shape_colors: ShapeColors = ShapeColors()
    sticky_colors: StickyColors = StickyColors()
    defaults: Defaults = Defaults()
    snap_tolerance_m: float = Field(0.15, ge=0, le=0.5)


DEFAULT_CONFIG_YAML = """\
# RoomLoom Miro import settings for this project. Edit, then run the importer again.
# Run the importer with --dry-run to list every colour found on the board.

# Title of the frame that holds the building. Without such a frame the whole board is used.
plan_frame: Plan
# Text of the large rectangle that holds building-wide notes.
notes_label: Notes

# Rectangle fill colours (#rrggbb, as Miro reports them). Any other fill is a room.
shape_colors:
  door: ["#f24726", "#ff0000"]
  window: ["#2d9bf0", "#12cdd4", "#6cd8fa"]
  passage: ["#808080"]
  notes_area: ["#8fd14f", "#0ca789", "#2dc75c"]

# Sticky note colour names (gray, light_yellow, yellow, orange, light_green, green, dark_green,
# cyan, light_pink, pink, violet, red, light_blue, blue, dark_blue, black).
sticky_colors:
  level: [orange]                 # "level -0.3", "steps 2"
  memory: [yellow, light_yellow]  # stored with the room

# Used when a shape's text gives no h= / sill= (metres).
defaults:
  ceiling_height: 2.6
  door: {height: 2.0, sill: 0.0}
  window: {height: 1.4, sill: 0.9}
  passage: {height: 2.2, sill: 0.0}

# Gaps and overlaps between room edges up to this size (metres) are closed.
snap_tolerance_m: 0.15
"""


def load_config(project_dir: Path) -> tuple[ImportConfig, bool]:
    """The project's import config, creating it with defaults first if missing.

    Returns the config and whether the file was just created.
    """
    path = project_dir / CONFIG_FILE
    created = not path.exists()
    if created:
        project_dir.mkdir(parents=True, exist_ok=True)
        path.write_text(DEFAULT_CONFIG_YAML, encoding="utf-8")
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return ImportConfig.model_validate(data), created
    except (yaml.YAMLError, ValidationError) as e:
        raise MiroImportError(f"{path} is not a valid import config:\n{e}") from e
