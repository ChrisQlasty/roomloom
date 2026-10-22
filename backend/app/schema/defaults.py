"""The default materials and roof every new scene starts with."""

from app.schema.scene import Material, Roof

_DEFAULTS: dict[str, tuple[str, str, float]] = {
    "mat_ceiling_default": ("Ceiling", "#f4f2ec", 0.95),
    "mat_facade_default": ("Facade", "#c9b79c", 0.9),
    "mat_floor_default": ("Floor", "#b5a58a", 0.8),
    "mat_roof_default": ("Roof", "#5a5a5a", 0.9),
    "mat_wall_default": ("Wall", "#e8e2d4", 0.9),
}


def default_materials() -> dict[str, Material]:
    """Fresh copies of the materials that rooms, the facade and the roof refer to by default."""
    return {
        mat_id: Material(name=name, color=color, roughness=roughness, source="default")
        for mat_id, (name, color, roughness) in _DEFAULTS.items()
    }


def default_roof() -> Roof:
    """A flat roof with the default material."""
    return Roof(type="flat")
