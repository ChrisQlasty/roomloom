"""The shared fixture project validates and matches what the T02 brief asks of it."""

import hashlib
import json

from app.schema.io import load_scene
from app.schema.objects import PrefabRef
from app.schema.project import Project
from tests.paths import EXAMPLE_PROJECT


def test_project_meta_validates() -> None:
    project = Project.model_validate_json((EXAMPLE_PROJECT / "project.json").read_bytes())
    assert project.slug == EXAMPLE_PROJECT.name


def test_scene_validates_and_has_the_required_features() -> None:
    scene = load_scene(EXAMPLE_PROJECT / "scene.json")
    rooms = scene.shell.rooms
    assert len(rooms) == 5
    assert any("corridor" in r.tags for r in rooms)
    assert sum("classroom" in r.tags for r in rooms) == 2
    assert any(len(r.polygon) > 4 for r in rooms)  # one room made of two rectangles
    sunken = [r for r in rooms if r.floor_level == -0.34]
    assert len(sunken) == 1
    assert [(t.steps, t.rise_total, t.host_room_id) for t in scene.shell.transitions] == [
        (2, 0.34, sunken[0].id)
    ]
    kinds = {o.kind for w in scene.shell.walls for o in w.openings}
    assert kinds == {"door", "window", "passage"}
    assert scene.roof.type == "flat"
    assert len(scene.objects) == 3
    assert not any(isinstance(o.geometry, PrefabRef) for o in scene.objects)
    assert [p.placed for p in scene.pins] == [True]


def test_footprint_is_about_30_by_20() -> None:
    outline = load_scene(EXAMPLE_PROJECT / "scene.json").shell.outline
    xs, ys = [p[0] for p in outline], [p[1] for p in outline]
    assert (max(xs) - min(xs), max(ys) - min(ys)) == (30.0, 20.0)


def test_assets_exist_and_match_their_hash() -> None:
    scene = load_scene(EXAMPLE_PROJECT / "scene.json")
    assert scene.assets
    for meta in scene.assets.values():
        data = (EXAMPLE_PROJECT / meta.path).read_bytes()
        assert hashlib.sha256(data).hexdigest() == meta.sha256


def test_no_number_has_more_than_three_decimals() -> None:
    def numbers(node: object) -> list[float]:
        if isinstance(node, float):
            return [node]
        if isinstance(node, dict):
            return [n for v in node.values() for n in numbers(v)]
        if isinstance(node, list):
            return [n for v in node for n in numbers(v)]
        return []

    data = json.loads((EXAMPLE_PROJECT / "scene.json").read_text())
    assert all(round(n, 3) == n for n in numbers(data))
