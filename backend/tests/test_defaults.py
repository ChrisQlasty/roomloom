from app.schema.defaults import default_materials, default_roof
from app.schema.shell import Surfaces


def test_defaults_cover_every_default_reference() -> None:
    materials = default_materials()
    surfaces = Surfaces()
    refs = {surfaces.floor, surfaces.ceiling, surfaces.walls, default_roof().material}
    assert refs | {"mat_facade_default"} == set(materials)
    assert all(m.source == "default" for m in materials.values())


def test_default_materials_are_fresh_copies() -> None:
    first = default_materials()
    first["mat_floor_default"].color = "#000000"
    assert default_materials()["mat_floor_default"].color != "#000000"
