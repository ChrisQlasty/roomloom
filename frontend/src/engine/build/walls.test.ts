import { describe, expect, it } from 'vitest';
import type { Opening, Wall } from '../../types/scene';
import type { MeshData, Vec2 } from './geometry-utils';
import { loadExampleScene } from './test-scene';
import {
  buildJunctionHub,
  buildWallGeometry,
  capPieces,
  computeWallJoins,
  layoutHoles,
  MIN_PIER,
  wallFrame,
  wallOutline,
  wallSpan,
  type WallEnd,
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

/** A free end extended by `ext` on both edges. */
function end(ext = 0): WallEnd {
  return { extLeft: ext, extRight: ext, joiners: [], covers: [] };
}

const triangleCount = (mesh: MeshData): number => mesh.indices.length / 3;

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

const FLAT: WallSpan = { bottom: 0, top: 3, threshold: 0, lower: null };

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
    expect(span.lower).toBe('right'); // the gym
    expect(wallSpan(corridorSouth, rooms)).toEqual({
      bottom: 0,
      top: 2.6,
      threshold: 0,
      lower: null,
    });
  });
});

const STEPPED: WallSpan = { bottom: -0.34, top: 3.26, threshold: 0, lower: 'right' };

describe('layoutHoles', () => {
  it('places several openings along one wall, measured from the threshold', () => {
    const span: WallSpan = { bottom: -0.34, top: 3.26, threshold: -0.34, lower: null };
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
    const stepped = layoutHoles([door], STEPPED)[0]!;
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
    const join: WallJoin = { a: end(0.15), b: end(0.15) };
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
      { a: end(), b: end() },
      [],
      [],
    );
    expect(normalOf(geometry.left)).toEqual([1, 0, 0]);
    expect(geometry.left.positions[0]).toBeCloseTo(0.15);
    expect(normalOf(geometry.right)).toEqual([-1, 0, 0]);
    expect(geometry.right.positions[0]).toBeCloseTo(-0.15);
  });

  it('keeps holes touching a free wall end inside the face', () => {
    const openings = [opening('op_a', 'window', 0, 1, 1, 1), opening('op_b', 'door', 4, 1, 2, 0)];
    expect(layoutHoles(openings, FLAT, [0, 5]).map((h) => [h.u0, h.u1])).toEqual([
      [MIN_PIER, 1],
      [4, 5 - MIN_PIER],
    ]);
    const geometry = buildWallGeometry(
      wall('w', [0, 0], [5, 0], 0.3, openings),
      FLAT,
      { a: end(), b: end() },
      [],
      [],
    );
    // Overlapping or missing triangles would change the area.
    const expected = 5 * 3 - (1 - MIN_PIER) * 1 - (1 - MIN_PIER) * 2;
    expect(area(geometry.left)).toBeCloseTo(expected);
    expect(area(geometry.right)).toBeCloseTo(expected);
  });

  it('closes a raised threshold with a sill on the lower side unless steps fill it', () => {
    const door = opening('op_door', 'door', 1, 1, 2, 0);
    const w = { ...wall('w', [0, 0], [4, 0], 0.12, [door]), right_room_id: 'r_low' };
    const join = { a: end(), b: end() };
    const open = buildWallGeometry(w, STEPPED, join, [], []).reveals.get('op_door')!;
    expect(triangleCount(open)).toBe(8);
    // The sill is the last quad: at threshold height, over the right (lower) half only.
    const sill = open.positions.slice(-12);
    expect([1, 4, 7, 10].map((i) => sill[i])).toEqual([0, 0, 0, 0]);
    const ws = [2, 5, 8, 11].map((i) => sill[i]! + 0);
    expect(Math.min(...ws)).toBeCloseTo(0);
    expect(Math.max(...ws)).toBeCloseTo(0.06); // world +Z is the right of a wall running east
    const stepped = buildWallGeometry(w, STEPPED, join, [], [], new Set(['op_door']));
    expect(triangleCount(stepped.reveals.get('op_door')!)).toBe(6);
  });
});

/** Whether a plan point lies in a wall's footprint after its ends are cut or extended. */
function inFootprint(w: Wall, join: WallJoin, [x, z]: Vec2, tol = 1e-6): boolean {
  const f = wallFrame(w.a, w.b);
  const half = w.thickness / 2;
  const u = (x - w.a[0]) * f.dir[0] + (z - w.a[1]) * f.dir[1];
  const s = (x - w.a[0]) * f.left[0] + (z - w.a[1]) * f.left[1];
  const t = (s + half) / (2 * half); // 0 on the right edge, 1 on the left
  const start = -(join.a.extRight + t * (join.a.extLeft - join.a.extRight));
  const stop = f.length + join.b.extRight + t * (join.b.extLeft - join.b.extRight);
  return u >= start - tol && u <= stop + tol && Math.abs(s) <= half + tol;
}

/** World points where a wall's left and right edges end at end `which`. */
function edgeEnds(w: Wall, join: WallJoin, which: 'a' | 'b'): Vec2[] {
  const f = wallFrame(w.a, w.b);
  const half = w.thickness / 2;
  const e = join[which];
  return [
    [half, e.extLeft],
    [-half, e.extRight],
  ].map(([s, ext]) => {
    const u = which === 'a' ? -ext! : f.length + ext!;
    return [w.a[0] + f.dir[0] * u + f.left[0] * s!, w.a[1] + f.dir[1] * u + f.left[1] * s!];
  });
}

/** Two walls meeting at an L corner of `angle` degrees between them. */
function corner(angle: number): Wall[] {
  const rad = (angle * Math.PI) / 180;
  return [
    wall('w1', [0, 0], [10, 0]),
    wall('w2', [10, 0], [10 - 5 * Math.cos(rad), -5 * Math.sin(rad)]),
  ];
}

describe('computeWallJoins', () => {
  it('mitres an L corner: each edge meets the matching edge of the other wall', () => {
    for (const angle of [90, 120, 60, 20]) {
      const walls = corner(angle);
      const { joins, hubs } = computeWallJoins(walls);
      const j1 = joins.get('w1')!;
      const j2 = joins.get('w2')!;
      expect(j1.b.joiners).toEqual(['w2']);
      expect(hubs).toEqual([]);
      const ends1 = edgeEnds(walls[0]!, j1, 'b');
      const ends2 = edgeEnds(walls[1]!, j2, 'a');
      // The corner's edge points coincide, so neither wall pokes past the other's face.
      for (const p of ends1) {
        const match = ends2.find((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-9);
        expect(match, `${angle}° at ${p.join(',')}`).toBeDefined();
      }
      // Each end hides the other wall's end cap.
      expect(j1.b.covers).toEqual([{ w0: -0.15, w1: 0.15, by: ['w2'] }]);
    }
    // At a right angle w1's inner (left, north) edge is cut back by half the other wall and its
    // outer edge runs on by as much.
    const square = computeWallJoins(corner(90)).joins.get('w1')!.b;
    expect(square.extLeft).toBeCloseTo(-0.15);
    expect(square.extRight).toBeCloseTo(0.15);
  });

  it('ends walls that continue straight on flat, and runs the stem to the far face', () => {
    const { joins } = computeWallJoins([
      wall('w1', [0, 0], [5, 0]),
      wall('w2', [5, 0], [9, 0]),
      wall('stem', [5, 0], [5, 4], 0.12),
    ]);
    expect(joins.get('w1')!.b).toMatchObject({ extLeft: 0, extRight: 0 });
    expect(joins.get('w2')!.a).toMatchObject({ extLeft: 0, extRight: 0 });
    const stem = joins.get('stem')!.a;
    expect(stem.extLeft).toBeCloseTo(0.15);
    expect(stem.extRight).toBeCloseTo(0.15);
    expect(stem.joiners.sort()).toEqual(['w1', 'w2']);
    expect(stem.covers).toEqual([{ w0: -0.06, w1: 0.06, by: ['w1', 'w2'] }]);
  });

  it('runs a slanted stem to the far face of the thinner through wall', () => {
    const walls = [
      wall('thick', [0, 0], [5, 0], 0.3),
      wall('thin', [5, 0], [9, 0], 0.12),
      wall('stem', [5, 0], [8, 3], 0.12),
    ];
    const { joins } = computeWallJoins(walls);
    // Both edge ends of the stem lie on the thin wall's far face (z = −0.06).
    for (const [x, z] of edgeEnds(walls[2]!, joins.get('stem')!, 'a')) {
      expect(z).toBeCloseTo(-0.06);
      expect(x).toBeGreaterThan(4.8);
    }
  });

  it('leaves the step of a thick wall continuing as a thin one open', () => {
    const walls = [wall('thick', [0, 0], [5, 0], 0.3), wall('thin', [5, 0], [9, 0], 0.12)];
    const { joins } = computeWallJoins(walls);
    const spans = new Map([
      ['thick', FLAT],
      ['thin', FLAT],
    ]);
    const thick = capPieces(0.15, FLAT, joins.get('thick')!.b.covers, spans);
    expect(thick.map((p) => [p.w0, p.w1])).toEqual([
      [-0.15, -0.06],
      [0.06, 0.15],
    ]);
    expect(capPieces(0.06, FLAT, joins.get('thin')!.a.covers, spans)).toEqual([]);
    // Above a lower neighbour the whole cap shows.
    const low = new Map([['thin', { ...FLAT, top: 2 }]]);
    expect(capPieces(0.15, FLAT, joins.get('thick')!.b.covers, low)).toContainEqual({
      w0: -0.06,
      w1: 0.06,
      v0: 2,
      v1: 3,
    });
  });

  it('joins ends that differ by float noise', () => {
    for (const [p, q] of [
      [-0.0001, 0.0001],
      [1.2345, 1.23449999],
    ] as const) {
      const { joins } = computeWallJoins([wall('w1', [-5, 0], [p, 0]), wall('w2', [q, 0], [q, 5])]);
      expect(joins.get('w1')!.b.joiners).toEqual(['w2']);
      expect(joins.get('w2')!.a.joiners).toEqual(['w1']);
    }
  });

  it('fills the middle of a junction of three mitred walls with a hub', () => {
    const arm = (id: string, deg: number): Wall => {
      const rad = (deg * Math.PI) / 180;
      return wall(id, [0, 0], [4 * Math.cos(rad), 4 * Math.sin(rad)]);
    };
    const walls = [arm('w1', 90), arm('w2', 210), arm('w3', 330)];
    const { joins, hubs } = computeWallJoins(walls);
    expect(hubs).toHaveLength(1);
    const hub = hubs[0]!;
    expect(hub.owner).toBe('w1');
    expect(hub.polygon).toHaveLength(3);
    const spans = new Map(walls.map((w) => [w.id, FLAT]));
    for (const w of walls)
      expect(capPieces(0.15, FLAT, joins.get(w.id)!.a.covers, spans)).toEqual([]);
    // An equilateral triangle with its sides on the walls' end lines, at the walls' top.
    const side = 0.3; // corners 0.15 / sin 60° from the centre
    const mesh = buildJunctionHub(hub, spans);
    expect(area(mesh)).toBeCloseTo((Math.sqrt(3) / 4) * side * side);
    expect(mesh.positions.filter((_, i) => i % 3 === 1).every((y) => y === 3)).toBe(true);
    // A taller wall gets a side where the hub stands above its neighbours.
    const taller = buildJunctionHub(hub, new Map([...spans, ['w2', { ...FLAT, top: 3.5 }]]));
    expect(triangleCount(taller)).toBe(1 + 2 * 2);
  });

  it('closes every corner and T-junction of the example project', () => {
    const { shell } = loadExampleScene();
    const { joins } = computeWallJoins(shell.walls);
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

    // Every edge run past its end point is buried in (or flush with) another wall.
    for (const w of shell.walls) {
      const join = joins.get(w.id)!;
      for (const which of ['a', 'b'] as const) {
        const e = join[which];
        const ends = edgeEnds(w, join, which);
        [e.extLeft, e.extRight].forEach((ext, k) => {
          if (ext > 0) expect(covered(ends[k]!, w.id), `${w.id} end ${which}`).toBe(true);
        });
      }
    }
  });
});
