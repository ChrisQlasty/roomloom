import { describe, expect, it } from 'vitest';
import type { Opening, Wall } from '../../types/scene';
import { triangleCount, type MeshData, type Vec2 } from './geometry-utils';
import { loadExampleScene } from './test-scene';
import {
  buildWallGeometry,
  computeWallJoins,
  layoutHoles,
  wallFrame,
  wallOutline,
  wallSpan,
  type WallJoin,
  type WallSpan,
} from './walls';

function opening(
  id: string,
  kind: Opening['kind'],
  offset: number,
  width: number,
  height: number,
  sill: number,
) {
  return { id, kind, offset, width, height, sill };
}

function wall(id: string, a: Vec2, b: Vec2, thickness = 0.3, openings: Opening[] = []): Wall {
  return {
    id,
    a: [a[0], a[1]],
    b: [b[0], b[1]],
    thickness,
    kind: 'exterior',
    left_room_id: 'r_x',
    right_room_id: null,
    openings,
    face_overrides: { left: null, right: null },
  };
}

/** Total area of a flat mesh. */
function area(mesh: MeshData): number {
  let sum = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const [a, b, c] = [0, 1, 2].map((k) =>
      mesh.positions.slice(mesh.indices[i + k]! * 3, mesh.indices[i + k]! * 3 + 3),
    );
    const u = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
    const v = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
    sum +=
      Math.hypot(
        u[1]! * v[2]! - u[2]! * v[1]!,
        u[2]! * v[0]! - u[0]! * v[2]!,
        u[0]! * v[1]! - u[1]! * v[0]!,
      ) / 2;
  }
  return sum;
}

/** First vertex normal, with −0 folded into 0. */
function normalOf(mesh: MeshData): number[] {
  return mesh.normals.slice(0, 3).map((c) => c + 0);
}

const FLAT: WallSpan = { bottom: 0, top: 3, threshold: 0 };

describe('wallFrame', () => {
  it('puts the left side on the left when walking a→b seen from above (north up)', () => {
    // Walking south (+Z), the left hand points east (+X).
    expect(wallFrame([0, 0], [0, 20]).left.map((c) => c + 0)).toEqual([1, 0]);
    // Walking east (+X), the left hand points north (−Z).
    expect(wallFrame([0, 0], [5, 0]).left).toEqual([0, -1]);
  });
});

describe('wallSpan', () => {
  it('spans the lowest floor to the highest ceiling and keeps the higher floor as threshold', () => {
    const scene = loadExampleScene();
    const rooms = new Map(scene.shell.rooms.map((r) => [r.id, r]));
    const hallGym = scene.shell.walls.find((w) => w.id === 'w_hall_gym_north')!;
    const span = wallSpan(hallGym, rooms)!;
    expect(span.bottom).toBe(-0.34);
    expect(span.top).toBeCloseTo(3.26);
    expect(span.threshold).toBe(0);
    const corridorSouth = scene.shell.walls.find((w) => w.id === 'w_corridor_south')!;
    expect(wallSpan(corridorSouth, rooms)).toEqual({ bottom: 0, top: 2.6, threshold: 0 });
  });
});

describe('layoutHoles', () => {
  it('places several openings along one wall, measured from the threshold', () => {
    const span: WallSpan = { bottom: -0.34, top: 3.26, threshold: -0.34 };
    const holes = layoutHoles(
      [opening('op_2', 'window', 4.5, 2.5, 1.2, 1.8), opening('op_1', 'window', 1, 2.5, 1.2, 1.8)],
      span,
    );
    expect(holes.map((h) => h.id)).toEqual(['op_1', 'op_2']);
    expect(holes[0]).toMatchObject({ u0: 1, u1: 3.5, notch: false });
    expect(holes[0]!.v0).toBeCloseTo(1.46);
    expect(holes[0]!.v1).toBeCloseTo(2.66);
    expect(holes[1]).toMatchObject({ u0: 4.5, u1: 7 });
  });

  it('cuts a door at floor level as a notch, but keeps a raised threshold as a hole', () => {
    const door = opening('op_door', 'door', 3, 1.6, 2.2, 0);
    expect(layoutHoles([door], FLAT)[0]).toMatchObject({ v0: 0, v1: 2.2, notch: true });
    const stepped = layoutHoles([door], { bottom: -0.34, top: 3.26, threshold: 0 })[0]!;
    expect(stepped).toMatchObject({ v0: 0, notch: false });
  });

  it('builds the outline with notches in order and the face area without the holes', () => {
    const openings = [
      opening('op_d1', 'door', 1, 1, 2, 0),
      opening('op_w', 'window', 3, 2, 1, 1),
      opening('op_d2', 'door', 6, 1, 2.1, 0),
    ];
    const holes = layoutHoles(openings, FLAT);
    expect(wallOutline(-0.15, 8.15, FLAT, holes)).toEqual([
      [-0.15, 0],
      [1, 0],
      [1, 2],
      [2, 0 + 2],
      [2, 0],
      [6, 0],
      [6, 2.1],
      [7, 2.1],
      [7, 0],
      [8.15, 0],
      [8.15, 3],
      [-0.15, 3],
    ]);
    const join: WallJoin = { extA: 0.15, extB: 0.15, joinersA: [], joinersB: [] };
    const geometry = buildWallGeometry(
      wall('w', [0, 0], [8, 0], 0.3, openings),
      FLAT,
      join,
      [],
      [],
    );
    const expected = 8.3 * 3 - 2 - 2 - 2.1;
    expect(area(geometry.left)).toBeCloseTo(expected);
    expect(area(geometry.right)).toBeCloseTo(expected);
    // Doors at floor level have no sill reveal (3 quads); the window has 4.
    expect(triangleCount(geometry.reveals.get('op_d1')!)).toBe(6);
    expect(triangleCount(geometry.reveals.get('op_w')!)).toBe(8);
  });

  it('builds both faces with normals pointing to their side', () => {
    const geometry = buildWallGeometry(
      wall('w', [0, 0], [0, 5]),
      FLAT,
      { extA: 0, extB: 0, joinersA: [], joinersB: [] },
      [],
      [],
    );
    expect(normalOf(geometry.left)).toEqual([1, 0, 0]);
    expect(geometry.left.positions[0]).toBeCloseTo(0.15);
    expect(normalOf(geometry.right)).toEqual([-1, 0, 0]);
    expect(geometry.right.positions[0]).toBeCloseTo(-0.15);
  });
});

/** The wall's plan footprint as an oriented rectangle test, after extending its ends. */
function inFootprint(w: Wall, join: WallJoin, [x, z]: Vec2, tol = 1e-6): boolean {
  const f = wallFrame(w.a, w.b);
  const u = (x - w.a[0]) * f.dir[0] + (z - w.a[1]) * f.dir[1];
  const s = (x - w.a[0]) * f.left[0] + (z - w.a[1]) * f.left[1];
  return (
    u >= -join.extA - tol && u <= f.length + join.extB + tol && Math.abs(s) <= w.thickness / 2 + tol
  );
}

describe('computeWallJoins', () => {
  it('extends both walls of an L corner by half the other wall', () => {
    const joins = computeWallJoins([
      wall('w1', [0, 0], [10, 0], 0.3),
      wall('w2', [10, 0], [10, 5], 0.12),
    ]);
    expect(joins.get('w1')).toEqual({ extA: 0, extB: 0.06, joinersA: [], joinersB: ['w2'] });
    expect(joins.get('w2')).toEqual({ extA: 0.15, extB: 0, joinersA: ['w1'], joinersB: [] });
  });

  it('does not extend walls that continue straight on, unless a third wall meets there', () => {
    const straight = computeWallJoins([wall('w1', [0, 0], [5, 0]), wall('w2', [5, 0], [9, 0])]);
    expect(straight.get('w1')!.extB).toBe(0);
    expect(straight.get('w2')!.extA).toBe(0);
    const tee = computeWallJoins([
      wall('w1', [0, 0], [5, 0]),
      wall('w2', [5, 0], [9, 0]),
      wall('stem', [5, 0], [5, 4], 0.12),
    ]);
    expect(tee.get('w1')!.extB).toBeCloseTo(0.06);
    expect(tee.get('w2')!.extA).toBeCloseTo(0.06);
    expect(tee.get('stem')!.extA).toBeCloseTo(0.15);
    expect(tee.get('stem')!.joinersA.sort()).toEqual(['w1', 'w2']);
  });

  it('extends further at sharp angles so the outer edge still closes', () => {
    const joins = computeWallJoins([wall('w1', [0, 0], [10, 0]), wall('w2', [10, 0], [5, 5])]);
    const join1 = joins.get('w1')!;
    const join2 = joins.get('w2')!;
    expect(join1.extB).toBeGreaterThan(0.15);
    const w1 = wall('w1', [0, 0], [10, 0]);
    const w2 = wall('w2', [10, 0], [5, 5]);
    const f1 = wallFrame(w1.a, w1.b);
    const f2 = wallFrame(w2.a, w2.b);
    // On each side, the two face lines meet at a corner that both extended walls must cover.
    for (const s of [0.15, -0.15]) {
      const p1: Vec2 = [w1.a[0] + f1.left[0] * s, w1.a[1] + f1.left[1] * s];
      const p2: Vec2 = [w2.a[0] + f2.left[0] * s, w2.a[1] + f2.left[1] * s];
      const det = f1.dir[0] * -f2.dir[1] + f2.dir[0] * f1.dir[1];
      const t = ((p2[0] - p1[0]) * -f2.dir[1] + f2.dir[0] * (p2[1] - p1[1])) / det;
      const corner: Vec2 = [p1[0] + f1.dir[0] * t, p1[1] + f1.dir[1] * t];
      expect(inFootprint(w1, join1, corner), `side ${s}`).toBe(true);
      expect(inFootprint(w2, join2, corner), `side ${s}`).toBe(true);
    }
  });

  it('closes every corner and T-junction of the example project', () => {
    const { shell } = loadExampleScene();
    const joins = computeWallJoins(shell.walls);
    const covered = (p: Vec2, except?: string): boolean =>
      shell.walls.some((w) => w.id !== except && inFootprint(w, joins.get(w.id)!, p));

    // Outer corners of the facade: each outline vertex pushed out by half the exterior thickness.
    const outline = shell.outline;
    const half = shell.wall_thickness.exterior / 2;
    outline.forEach((v, i) => {
      const prev = outline[(i + outline.length - 1) % outline.length]!;
      const next = outline[(i + 1) % outline.length]!;
      const outward = (from: Vec2, to: Vec2): Vec2 => {
        const f = wallFrame(from, to);
        return [-f.left[0], -f.left[1]]; // rooms are on the left of CCW outline edges
      };
      const n1 = outward(prev, v);
      const n2 = outward(v, next);
      const corner: Vec2 = [v[0] + (n1[0] + n2[0]) * half, v[1] + (n1[1] + n2[1]) * half];
      expect(covered(corner), `outer corner at ${v.join(',')}`).toBe(true);
    });

    // Every extended end is buried in another wall: its end-cap corners lie inside a joining wall.
    for (const w of shell.walls) {
      const join = joins.get(w.id)!;
      const f = wallFrame(w.a, w.b);
      for (const [u, ext] of [
        [-join.extA, join.extA],
        [f.length + join.extB, join.extB],
      ] as const) {
        if (ext === 0) continue;
        for (const s of [-w.thickness / 2, w.thickness / 2]) {
          const p: Vec2 = [
            w.a[0] + f.dir[0] * u + f.left[0] * s,
            w.a[1] + f.dir[1] * u + f.left[1] * s,
          ];
          expect(covered(p, w.id), `${w.id} end at ${u}`).toBe(true);
        }
      }
    }
  });
});
