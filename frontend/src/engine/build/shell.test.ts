import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Scene } from '../../types/scene';
import { MaterialLibrary } from './materials';
import {
  affectedByRooms,
  buildShellParts,
  resolveShellHit,
  ShellBuilder,
  shellContext,
  type ShellTag,
} from './shell';
import { loadExampleScene } from './test-scene';

function buildExample(scene: Scene = loadExampleScene()): ShellBuilder {
  const builder = new ShellBuilder(new MaterialLibrary(scene.materials, { quality: 'low' }));
  builder.build(scene.shell);
  builder.root.updateMatrixWorld(true);
  return builder;
}

/** The tag of the first shell surface hit by a ray. */
function cast(
  builder: ShellBuilder,
  origin: [number, number, number],
  dir: [number, number, number],
) {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...dir).normalize(),
  );
  const hit = raycaster.intersectObject(builder.root, true)[0];
  return hit ? { tag: resolveShellHit(hit), point: hit.point } : null;
}

describe('buildShellParts', () => {
  const scene = loadExampleScene();
  const parts = [...buildShellParts(shellContext(scene.shell)).values()].flat();

  it('tags floors, ceilings, both faces of every wall, every opening and the steps', () => {
    const tags = parts.map((p) => p.tag);
    const has = (t: Partial<ShellTag>): boolean =>
      tags.some((tag) => Object.entries(t).every(([k, v]) => tag[k as keyof ShellTag] === v));
    for (const room of scene.shell.rooms) {
      expect(has({ kind: 'floor', id: room.id, roomId: room.id })).toBe(true);
      expect(has({ kind: 'ceiling', id: room.id })).toBe(true);
    }
    for (const wall of scene.shell.walls) {
      expect(has({ kind: 'wall_face', id: wall.id, side: 'left', roomId: wall.left_room_id })).toBe(
        true,
      );
      expect(
        has({ kind: 'wall_face', id: wall.id, side: 'right', roomId: wall.right_room_id }),
      ).toBe(true);
      for (const opening of wall.openings)
        expect(has({ kind: 'opening', id: opening.id })).toBe(true);
    }
    expect(has({ kind: 'stairs', id: 'tr_gym_steps', roomId: 'r_gym' })).toBe(true);
  });

  it('gives exterior faces the facade and interior faces their room material', () => {
    const face = (id: string, side: 'left' | 'right') =>
      parts.find((p) => p.tag.kind === 'wall_face' && p.tag.id === id && p.tag.side === side)!;
    expect(face('w_hall_west', 'right').material).toBe('mat_facade_default');
    expect(face('w_hall_west', 'left').material).toBe('mat_wall_default');
  });

  it('uses a face override when set', () => {
    const custom = loadExampleScene();
    custom.shell.walls.find((w) => w.id === 'w_hall_west')!.face_overrides.left = 'mat_wall_board';
    const face = [...buildShellParts(shellContext(custom.shell)).values()]
      .flat()
      .find((p) => p.tag.id === 'w_hall_west' && p.tag.side === 'left')!;
    expect(face.material).toBe('mat_wall_board');
  });

  it("adds the neighbours' corners to floors and ceilings, so seams have no cracks", () => {
    // The hall's east edge (12,10)–(12,0) passes Room 1's corner (12, 7) on the corridor.
    for (const kind of ['floor', 'ceiling']) {
      const hall = parts.find((p) => p.tag.kind === kind && p.tag.id === 'r_entrance_hall')!;
      const xz = hall.data.positions.flatMap((v, i) =>
        i % 3 === 0 ? [[v, hall.data.positions[i + 2]]] : [],
      );
      expect(xz, kind).toContainEqual([12, 7]);
    }
  });
});

describe('ShellBuilder', () => {
  it('merges the example shell into far fewer than 150 draw calls', () => {
    const builder = buildExample();
    const meshes: THREE.Mesh[] = [];
    builder.root.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    expect(meshes.length).toBeLessThan(150);
    expect(meshes.length).toBeLessThanOrEqual(10);
    expect(builder.ceilings.children.every((m) => m.userData.layer === 'ceiling')).toBe(true);
  });

  it('resolves raycasts on merged meshes to entities', () => {
    const builder = buildExample();
    const gymFloor = cast(builder, [8, 1, 15], [0, -1, 0])!;
    expect(gymFloor.tag).toEqual({ kind: 'floor', id: 'r_gym', roomId: 'r_gym', side: null });
    expect(gymFloor.point.y).toBeCloseTo(-0.34);

    const gymCeiling = cast(builder, [8, 1, 15], [0, 1, 0])!;
    expect(gymCeiling.tag?.kind).toBe('ceiling');
    expect(gymCeiling.point.y).toBeCloseTo(3.26);

    // From Room 1, looking west at the wall to the hall: Room 1 is on its left.
    const inside = cast(builder, [16, 1.5, 3.5], [-1, 0, 0])!;
    expect(inside.tag).toEqual({
      kind: 'wall_face',
      id: 'w_hall_room_1',
      roomId: 'r_room_1',
      side: 'left',
    });
    expect(inside.point.x).toBeCloseTo(12.06);

    // From outside, west of the building: the facade.
    const outside = cast(builder, [-5, 1.5, 15], [1, 0, 0])!;
    expect(outside.tag).toEqual({
      kind: 'wall_face',
      id: 'w_hall_west',
      roomId: null,
      side: 'right',
    });
    expect(outside.point.x).toBeCloseTo(-0.15);
  });

  it('cuts openings through both faces', () => {
    const builder = buildExample();
    // Room 1's first north window spans x 17.5–19.5, 0.9–2.5 m high: the ray meets its glass.
    expect(cast(builder, [18.5, 1.5, -5], [0, 0, 1])!.tag).toMatchObject({
      kind: 'opening',
      id: 'op_room_1_window_1',
    });
    // Through the passage from the hall into the corridor (wall x = 12, z 7.5–9.5): the next
    // surface is the corridor's east wall, just beside its side door (z 8.1–9.1).
    const through = cast(builder, [6, 1.2, 7.7], [1, 0, 0])!;
    expect(through.tag).toMatchObject({ id: 'w_corridor_east', side: 'left' });
    // And through the side door itself the ray leaves the building.
    expect(cast(builder, [6, 1.2, 8.6], [1, 0, 0])).toBeNull();
  });

  it('rebuilds walls when a ceiling changes', () => {
    const scene = loadExampleScene();
    const builder = buildExample(scene);
    // At 2.8 m the ray passes over the corridor's 2.6 m outer wall and meets the 3 m wall to Room 1.
    expect(cast(builder, [20, 2.8, 12], [0, 0, -1])!.tag?.id).toBe('w_room_1_corridor');

    scene.shell.rooms.find((r) => r.id === 'r_corridor')!.ceiling_height = 2.9;
    builder.rebuildRooms(['r_corridor'], scene.shell);
    builder.root.updateMatrixWorld(true);
    expect(cast(builder, [20, 2.8, 12], [0, 0, -1])!.tag?.id).toBe('w_corridor_south');
    expect(cast(builder, [20, 1, 8.5], [0, 1, 0])!.point.y).toBeCloseTo(2.9);
  });
});

describe('affectedByRooms', () => {
  it('includes the room, its walls, the walls meeting them and its steps', () => {
    const { shell } = loadExampleScene();
    const keys = affectedByRooms(shellContext(shell), ['r_gym']);
    expect(keys).toContain('room:r_gym');
    expect(keys).toContain('wall:w_gym_east');
    expect(keys).toContain('wall:w_corridor_south'); // meets w_gym_east at (12, 10)
    expect(keys).toContain('transition:tr_gym_steps');
    expect(keys).not.toContain('room:r_room_2');
    expect(keys).not.toContain('wall:w_room_2_east');
  });
});
