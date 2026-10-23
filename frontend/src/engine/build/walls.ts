import type { Opening, Room, Wall } from '../../types/scene';
import {
  addFace,
  addQuad,
  EPS,
  emptyMesh,
  triangulate,
  type MeshData,
  type Vec2,
  type Vec3,
} from './geometry-utils';

/**
 * A wall's local frame: u runs along the centre line from a (metres), v is world height,
 * w runs across the wall towards its left side (as seen from above, walking a→b).
 */
export interface WallFrame {
  origin: Vec2;
  dir: Vec2;
  left: Vec2;
  length: number;
}

/** Vertical extent of a wall, derived from the rooms beside it (world metres). */
export interface WallSpan {
  /** Lowest floor of the rooms beside the wall. */
  bottom: number;
  /** Highest ceiling of the rooms beside the wall. */
  top: number;
  /** Highest floor: opening sills are measured from here. */
  threshold: number;
}

/** How a wall meets the walls sharing its end points. */
export interface WallJoin {
  /** Extension beyond end a, so corners and T-junctions close without gaps. */
  extA: number;
  extB: number;
  /** Ids of the other walls that end at a (or b). */
  joinersA: string[];
  joinersB: string[];
}

/** A rectangular hole in wall-local (u, v) coordinates. */
export interface Hole {
  id: string;
  kind: Opening['kind'];
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** The hole reaches the bottom of the wall, so it is cut from the outline instead of being a hole. */
  notch: boolean;
}

/** Below this sine the walls at a joint count as collinear (about 1°). */
const COLLINEAR_SIN = 0.02;

/** The local frame of the centre line a→b. */
export function wallFrame(a: Vec2, b: Vec2): WallFrame {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const dir: Vec2 = [dx / length, dz / length];
  // Left of the walking direction as seen from above, with north (−Z) up and east (+X) right.
  return { origin: a, dir, left: [dir[1], -dir[0]], length };
}

/** World position of the local point (u, v, w). */
export function framePoint(f: WallFrame, u: number, v: number, w: number): Vec3 {
  return [
    f.origin[0] + f.dir[0] * u + f.left[0] * w,
    v,
    f.origin[1] + f.dir[1] * u + f.left[1] * w,
  ];
}

/** World direction of a local axis, times `sign`. */
export function frameAxis(f: WallFrame, axis: 'u' | 'v' | 'w', sign: 1 | -1): Vec3 {
  if (axis === 'v') return [0, sign, 0];
  const d = axis === 'u' ? f.dir : f.left;
  return [d[0] * sign, 0, d[1] * sign];
}

/** Append a local-axis-aligned box spanning `[u0, u1] × [v0, v1] × [w0, w1]`; UVs in metres. */
export function addFrameBox(
  mesh: MeshData,
  f: WallFrame,
  [u0, u1]: Vec2,
  [v0, v1]: Vec2,
  [w0, w1]: Vec2,
): void {
  const p = (u: number, v: number, w: number): Vec3 => framePoint(f, u, v, w);
  for (const [u, s] of [
    [u0, -1],
    [u1, 1],
  ] as const) {
    const uvs: Vec2[] = [
      [w0, v0],
      [w1, v0],
      [w1, v1],
      [w0, v1],
    ];
    addQuad(
      mesh,
      [p(u, v0, w0), p(u, v0, w1), p(u, v1, w1), p(u, v1, w0)],
      uvs,
      frameAxis(f, 'u', s),
    );
  }
  for (const [v, s] of [
    [v0, -1],
    [v1, 1],
  ] as const) {
    const uvs: Vec2[] = [
      [u0, w0],
      [u1, w0],
      [u1, w1],
      [u0, w1],
    ];
    addQuad(
      mesh,
      [p(u0, v, w0), p(u1, v, w0), p(u1, v, w1), p(u0, v, w1)],
      uvs,
      frameAxis(f, 'v', s),
    );
  }
  for (const [w, s] of [
    [w0, -1],
    [w1, 1],
  ] as const) {
    const uvs: Vec2[] = [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ];
    addQuad(
      mesh,
      [p(u0, v0, w), p(u1, v0, w), p(u1, v1, w), p(u0, v1, w)],
      uvs,
      frameAxis(f, 'w', s),
    );
  }
}

/** Height range of a wall from the rooms on its sides; null if it has none. */
export function wallSpan(wall: Wall, rooms: ReadonlyMap<string, Room>): WallSpan | null {
  const sides = [wall.left_room_id, wall.right_room_id]
    .map((id) => (id === null ? undefined : rooms.get(id)))
    .filter((room): room is Room => room !== undefined);
  if (sides.length === 0) return null;
  const floors = sides.map((r) => r.floor_level);
  return {
    bottom: Math.min(...floors),
    top: Math.max(...sides.map((r) => r.floor_level + r.ceiling_height)),
    threshold: Math.max(...floors),
  };
}

function pointKey([x, z]: Vec2): string {
  return `${x.toFixed(3)},${z.toFixed(3)}`;
}

/**
 * How far one wall end must run past the joint to reach the far face of a wall meeting it at
 * an angle: half the other wall's thickness when perpendicular, more at sharper angles.
 */
function joinExtension(
  own: Vec2,
  ownThickness: number,
  other: Vec2,
  otherThickness: number,
): number {
  const sin = Math.abs(own[0] * other[1] - own[1] * other[0]);
  if (sin < COLLINEAR_SIN) return 0;
  const cos = Math.abs(own[0] * other[0] + own[1] * other[1]);
  const ext = (otherThickness / 2 + (ownThickness / 2) * cos) / sin;
  return Math.min(ext, 2 * Math.max(ownThickness, otherThickness));
}

/**
 * For every wall, the walls sharing each end point and how far to extend that end.
 * A wall continuing straight on adds nothing; a wall meeting at an angle adds half its
 * thickness (at right angles), so L-corners, T-junctions and crossings close without gaps.
 */
export function computeWallJoins(
  walls: readonly Pick<Wall, 'id' | 'a' | 'b' | 'thickness'>[],
): Map<string, WallJoin> {
  interface End {
    id: string;
    away: Vec2;
    thickness: number;
  }
  const ends = new Map<string, End[]>();
  const add = (point: Vec2, end: End): void => {
    const key = pointKey(point);
    ends.set(key, [...(ends.get(key) ?? []), end]);
  };
  for (const w of walls) {
    const f = wallFrame(w.a, w.b);
    add(w.a, { id: w.id, away: f.dir, thickness: w.thickness });
    add(w.b, { id: w.id, away: [-f.dir[0], -f.dir[1]], thickness: w.thickness });
  }
  const joinAt = (point: Vec2, id: string): { ext: number; joiners: string[] } => {
    const here = ends.get(pointKey(point)) ?? [];
    const own = here.find((e) => e.id === id)!;
    const others = here.filter((e) => e !== own);
    const ext = Math.max(
      0,
      ...others.map((o) => joinExtension(own.away, own.thickness, o.away, o.thickness)),
    );
    return { ext, joiners: others.map((o) => o.id) };
  };
  const joins = new Map<string, WallJoin>();
  for (const w of walls) {
    const a = joinAt(w.a, w.id);
    const b = joinAt(w.b, w.id);
    joins.set(w.id, { extA: a.ext, extB: b.ext, joinersA: a.joiners, joinersB: b.joiners });
  }
  return joins;
}

/** Openings as holes in wall-local coordinates, sorted along the wall. */
export function layoutHoles(openings: readonly Opening[], span: WallSpan): Hole[] {
  return openings
    .map((o) => {
      const v0 = span.threshold + o.sill;
      return {
        id: o.id,
        kind: o.kind,
        u0: o.offset,
        u1: o.offset + o.width,
        v0,
        v1: v0 + o.height,
        notch: v0 <= span.bottom + EPS,
      };
    })
    .sort((p, q) => p.u0 - q.u0);
}

/** The wall face outline from `uStart` to `uEnd`, with notches cut for holes that reach the bottom. */
export function wallOutline(
  uStart: number,
  uEnd: number,
  span: WallSpan,
  holes: readonly Hole[],
): Vec2[] {
  const { bottom, top } = span;
  const points: Vec2[] = [[uStart, bottom]];
  for (const h of holes.filter((hole) => hole.notch)) {
    points.push([h.u0, bottom], [h.u0, h.v1], [h.u1, h.v1], [h.u1, bottom]);
  }
  points.push([uEnd, bottom], [uEnd, top], [uStart, top]);
  return points.filter((p, i) => {
    const prev = points[(i + points.length - 1) % points.length]!;
    return Math.abs(p[0] - prev[0]) > EPS || Math.abs(p[1] - prev[1]) > EPS;
  });
}

/** Wall meshes, split by what they look into. */
export interface WallGeometry {
  frame: WallFrame;
  holes: Hole[];
  /** Face on the left of a→b (w = +thickness / 2). */
  left: MeshData;
  right: MeshData;
  /** Top and the exposed parts of the end caps. */
  edges: MeshData;
  /** Reveals (jambs, head, sill) per opening id. */
  reveals: Map<string, MeshData>;
}

/**
 * Build a wall as its face outline (length × height, holes for openings) extruded by its thickness.
 * `capsA`/`capsB` are the height intervals of the end caps that other walls do not hide.
 */
export function buildWallGeometry(
  wall: Wall,
  span: WallSpan,
  join: WallJoin,
  capsA: readonly Vec2[],
  capsB: readonly Vec2[],
): WallGeometry {
  const f = wallFrame(wall.a, wall.b);
  const half = wall.thickness / 2;
  const uStart = -join.extA;
  const uEnd = f.length + join.extB;
  const holes = layoutHoles(wall.openings, span);
  const outline = wallOutline(uStart, uEnd, span, holes);
  const inner = holes
    .filter((h) => !h.notch)
    .map((h): Vec2[] => [
      [h.u0, h.v0],
      [h.u1, h.v0],
      [h.u1, h.v1],
      [h.u0, h.v1],
    ]);
  const ring = [...outline, ...inner.flat()];
  const triangles = triangulate(outline, inner);
  // Texture u follows the world along the wall, so collinear walls continue the same pattern,
  // and runs left to right for a viewer on each side.
  const s0 = f.origin[0] * f.dir[0] + f.origin[1] * f.dir[1];
  const face = (w: number, sign: 1 | -1): MeshData => {
    const mesh = emptyMesh();
    const points = ring.map(([u, v]) => framePoint(f, u, v, w));
    const uvs = ring.map(([u, v]): Vec2 => [sign * -(s0 + u), v]);
    addFace(mesh, points, uvs, triangles, frameAxis(f, 'w', sign));
    return mesh;
  };

  const edges = emptyMesh();
  const p = (u: number, v: number, w: number): Vec3 => framePoint(f, u, v, w);
  addQuad(
    edges,
    [
      p(uStart, span.top, -half),
      p(uEnd, span.top, -half),
      p(uEnd, span.top, half),
      p(uStart, span.top, half),
    ],
    [
      [uStart, -half],
      [uEnd, -half],
      [uEnd, half],
      [uStart, half],
    ],
    [0, 1, 0],
  );
  for (const [u, caps, sign] of [
    [uStart, capsA, -1],
    [uEnd, capsB, 1],
  ] as const) {
    for (const [v0, v1] of caps) {
      addQuad(
        edges,
        [p(u, v0, -half), p(u, v0, half), p(u, v1, half), p(u, v1, -half)],
        [
          [-half, v0],
          [half, v0],
          [half, v1],
          [-half, v1],
        ],
        frameAxis(f, 'u', sign),
      );
    }
  }

  const reveals = new Map<string, MeshData>();
  for (const h of holes) {
    const mesh = emptyMesh();
    const across: Vec2[] = [
      [-half, h.v0],
      [half, h.v0],
      [half, h.v1],
      [-half, h.v1],
    ];
    addQuad(
      mesh,
      [p(h.u0, h.v0, -half), p(h.u0, h.v0, half), p(h.u0, h.v1, half), p(h.u0, h.v1, -half)],
      across,
      frameAxis(f, 'u', 1),
    );
    addQuad(
      mesh,
      [p(h.u1, h.v0, -half), p(h.u1, h.v0, half), p(h.u1, h.v1, half), p(h.u1, h.v1, -half)],
      across,
      frameAxis(f, 'u', -1),
    );
    const along = (v: number): Vec3[] => [
      p(h.u0, v, -half),
      p(h.u1, v, -half),
      p(h.u1, v, half),
      p(h.u0, v, half),
    ];
    const alongUv: Vec2[] = [
      [h.u0, -half],
      [h.u1, -half],
      [h.u1, half],
      [h.u0, half],
    ];
    addQuad(mesh, along(h.v1), alongUv, [0, -1, 0]);
    // A sill only where the hole starts above the threshold; at threshold level the floors
    // (and the steps on the lower side) already cover the opening's bottom.
    if (h.v0 > span.threshold + EPS) addQuad(mesh, along(h.v0), alongUv, [0, 1, 0]);
    reveals.set(h.id, mesh);
  }

  return { frame: f, holes, left: face(half, 1), right: face(-half, -1), edges, reveals };
}
