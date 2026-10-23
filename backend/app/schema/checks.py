"""Cross-entity integrity checks for a Scene. Each check returns human-readable problems."""

from collections import Counter
from collections.abc import Callable, Iterator
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.schema.scene import Scene
    from app.schema.shell import Wall

TOLERANCE = 1e-6
LEVEL_TOLERANCE = 0.005
CEILING_CLEARANCE = 0.05


def scene_problems(scene: "Scene") -> list[str]:
    """Run every check and return all problems found (empty if the scene is consistent)."""
    return [problem for check in CHECKS for problem in check(scene)]


def _unique_ids(scene: "Scene") -> Iterator[str]:
    shell = scene.shell
    ids = [
        *(r.id for r in shell.rooms),
        *(w.id for w in shell.walls),
        *(o.id for w in shell.walls for o in w.openings),
        *(t.id for t in shell.transitions),
        *(o.id for o in scene.objects),
        *(p.id for p in scene.pins),
        *(n.id for n in scene.notes),
    ]
    for entity_id, count in Counter(ids).items():
        if count > 1:
            yield f"duplicate id {entity_id}"


def _material_refs(scene: "Scene") -> Iterator[tuple[str, str]]:
    """Yield (where, material id) for every material reference in the scene."""
    yield "shell.facade_material", scene.shell.facade_material
    yield "roof.material", scene.roof.material
    if scene.roof.fascia_material:
        yield "roof.fascia_material", scene.roof.fascia_material
    for room in scene.shell.rooms:
        for surface, ref in room.surfaces:
            yield f"room {room.id} {surface}", ref
    for wall in scene.shell.walls:
        for side, ref in wall.face_overrides:
            if ref:
                yield f"wall {wall.id} {side} face", ref
    for obj in scene.objects:
        for slot, ref in obj.materials.items():
            yield f"object {obj.id} slot {slot}", ref


def _references(scene: "Scene") -> Iterator[str]:
    room_ids = {r.id for r in scene.shell.rooms}
    opening_ids = {o.id for w in scene.shell.walls for o in w.openings}
    for where, ref in _material_refs(scene):
        if ref not in scene.materials:
            yield f"{where} references unknown material {ref}"
    for mat_id, mat in scene.materials.items():
        if mat.texture_asset and mat.texture_asset not in scene.assets:
            yield f"material {mat_id} references unknown asset {mat.texture_asset}"
    for pin in scene.pins:
        if pin.asset_id not in scene.assets:
            yield f"pin {pin.id} references unknown asset {pin.asset_id}"
    for obj in scene.objects:
        if obj.room_id and obj.room_id not in room_ids:
            yield f"object {obj.id} references unknown room {obj.room_id}"
    for wall in scene.shell.walls:
        for room_id in wall.room_ids:
            if room_id not in room_ids:
                yield f"wall {wall.id} references unknown room {room_id}"
    for note in scene.notes:
        for room_id in note.room_ids:
            if room_id not in room_ids:
                yield f"note {note.id} references unknown room {room_id}"
    for tr in scene.shell.transitions:
        if tr.opening_id not in opening_ids:
            yield f"transition {tr.id} references unknown opening {tr.opening_id}"
        if tr.host_room_id not in room_ids:
            yield f"transition {tr.id} references unknown room {tr.host_room_id}"


def _wall_adjacency(scene: "Scene") -> Iterator[str]:
    for wall in scene.shell.walls:
        rooms = wall.room_ids
        if wall.kind == "exterior" and len(rooms) != 1:
            yield f"exterior wall {wall.id} must bound exactly one room"
        if wall.kind == "interior" and (len(rooms) != 2 or rooms[0] == rooms[1]):
            yield f"interior wall {wall.id} must bound two different rooms"


def _openings_fit(scene: "Scene") -> Iterator[str]:
    for wall in scene.shell.walls:
        furthest_end, furthest_id = 0.0, None  # opening reaching furthest along the wall so far
        for op in sorted(wall.openings, key=lambda o: o.offset):
            end = op.offset + op.width
            if end > wall.length + TOLERANCE:
                yield f"opening {op.id} extends past the end of wall {wall.id}"
            if furthest_id and op.offset < furthest_end - TOLERANCE:
                yield f"openings {furthest_id} and {op.id} overlap in wall {wall.id}"
            if end > furthest_end:
                furthest_end, furthest_id = end, op.id


def _threshold_level(wall: "Wall", levels: dict[str, float]) -> float:
    """Floor level openings in this wall are measured from: the higher adjacent floor."""
    return max((levels[r] for r in wall.room_ids if r in levels), default=0.0)


def _transitions(scene: "Scene") -> Iterator[str]:
    levels = {r.id: r.floor_level for r in scene.shell.rooms}
    wall_of = {o.id: w for w in scene.shell.walls for o in w.openings}
    for tr in scene.shell.transitions:
        wall = wall_of.get(tr.opening_id)
        if wall is None or tr.host_room_id not in levels:
            continue  # reported by _references
        if tr.host_room_id not in wall.room_ids:
            yield f"transition {tr.id}: host room {tr.host_room_id} is not beside the opening"
            continue
        wall_levels = sorted(levels[r] for r in wall.room_ids if r in levels)
        if wall.kind == "interior" and len(wall_levels) == 2:  # else reported by _wall_adjacency
            low, high = wall_levels
            if abs((high - low) - tr.rise_total) > LEVEL_TOLERANCE:
                yield (
                    f"transition {tr.id}: rise_total {tr.rise_total} does not match the floor "
                    f"level difference {high - low:.3f}"
                )


def _ceiling_heights(scene: "Scene") -> Iterator[str]:
    levels = {r.id: r.floor_level for r in scene.shell.rooms}
    highest_top: dict[str, float] = {}
    for wall in scene.shell.walls:
        base = _threshold_level(wall, levels)
        for op in wall.openings:
            top = base + op.sill + op.height
            for room_id in wall.room_ids:
                highest_top[room_id] = max(highest_top.get(room_id, top), top)
    for room in scene.shell.rooms:
        if room.id not in highest_top:
            continue
        needed = highest_top[room.id] + CEILING_CLEARANCE - room.floor_level
        if room.ceiling_height < needed - TOLERANCE:
            yield (
                f"room {room.id}: ceiling_height {room.ceiling_height} is below the highest "
                f"opening top + {CEILING_CLEARANCE} m ({needed:.3f})"
            )


def _gable_edges(scene: "Scene") -> Iterator[str]:
    edge_count = len(scene.shell.outline)
    for index in scene.roof.gable_edges or []:
        if not 0 <= index < edge_count:
            yield f"roof gable edge {index} is not an outline edge (0..{edge_count - 1})"


CHECKS: list[Callable[["Scene"], Iterator[str]]] = [
    _unique_ids,
    _references,
    _wall_adjacency,
    _openings_fit,
    _transitions,
    _ceiling_heights,
    _gable_edges,
]
