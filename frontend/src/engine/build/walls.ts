import type { Opening, Room, Wall } from '../../types/scene';
import {
  addFace,
  addQuad,
  EPS,
  emptyMesh,
  triangulate,
  uncoveredIntervals,
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
  /** Side whose floor is at `bottom` when the floors on the two sides differ, else null. */
  lower: 'left' | 'right' | null;
}

/** A band `w0 ≤ w ≤ w1` of an end cap that other walls hide where they all reach (always, if `by` is empty). */
export interface CapCover {
  w0: number;
  w1: number;
  by: string[];
}

/** How one wall end meets the other walls ending at the same point. */
export interface WallEnd {
  /**
   * How far the left (w = +t/2) and right (w = −t/2) edges run past the end point; negative cuts
   * the edge back. Different values give a slanted (mitred) end.
   */
  extLeft: number;
  extRight: number;
  /** Ids of the other walls ending at this point. */
  joiners: string[];
  /** Parts of the end cap that other walls (or a junction hub) hide. */
  covers: CapCover[];
}

/** How a wall meets the walls sharing its end points. */
export interface WallJoin {
  a: WallEnd;
  b: WallEnd;
}

/** One wall's end as a side of a junction hub, from its right edge to its left edge (plan). */
export interface HubSide {
  wall: string;
  from: Vec2;
  to: Vec2;
}

/** The middle of a junction of three or more mitred walls, which none of them covers. */
export interface JunctionHub {
  /** Wall whose geometry carries the hub (the smallest id, so rebuilds find it). */
  owner: string;
  sides: HubSide[];
  /** Plan outline: the walls' edge end points in order around the junction. */
  polygon: Vec2[];
}

/** Joins of every wall, plus the hubs filling junctions of three or more mitred walls. */
export interface WallJoins {
  joins: Map<string, WallJoin>;
  hubs: JunctionHub[];
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

/** A visible rectangle of an end cap, in wall-local w and height. */
export interface CapPiece {
  w0: number;
  w1: number;
  v0: number;
  v1: number;
}

/** Below this sine the walls at a joint count as parallel (about 1°). */
const COLLINEAR_SIN = 0.02;
/** Wall ends closer than this (metres) meet at the same junction. */
const JOIN_TOLERANCE = 1e-3;
/** Narrowest strip of wall kept between a hole and the end of a wall face (metres). */
export const MIN_PIER = 0.01;

const cross2 = (p: Vec2, q: Vec2): number => p[0] * q[1] - p[1] * q[0];
const dot2 = (p: Vec2, q: Vec2): number => p[0] * q[0] + p[1] * q[1];
/** The left of direction `d` as seen from above, with north (−Z) up and east (+X) right. */
const leftOf = (d: Vec2): Vec2 => [d[1], -d[0]];

/** The local frame of the centre line a→b. */
export function wallFrame(a: Vec2, b: Vec2): WallFrame {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const length = Math.hypot(dx, dz);
  const dir: Vec2 = [dx / length, dz / length];
  return { origin: a, dir, left: leftOf(dir), length };
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
  const room = (id: string | null): Room | undefined => (id === null ? undefined : rooms.get(id));
  const left = room(wall.left_room_id);
  const right = room(wall.right_room_id);
  const sides = [left, right].filter((r): r is Room => r !== undefined);
  if (sides.length === 0) return null;
  const floors = sides.map((r) => r.floor_level);
  const bottom = Math.min(...floors);
  const threshold = Math.max(...floors);
  const stepped = left && right && threshold - bottom > EPS;
  return {
    bottom,
    top: Math.max(...sides.map((r) => r.floor_level + r.ceiling_height)),
    threshold,
    lower: stepped ? (left.floor_level < right.floor_level ? 'left' : 'right') : null,
  };
}

/** One wall end at a junction, described walking away from the junction along the wall. */
interface JunctionEnd {
  id: string;
  /** End a walks along the wall's frame, end b against it. */
  atA: boolean;
  away: Vec2;
  half: number;
  length: number;
  /** Extensions of the edges left and right of `away`. */
  extL: number;
  extR: number;
  /** Cap covers, with w measured towards the left of `away`. */
  covers: CapCover[];
}

/**
 * Walls continuing straight on through a junction end flat at it; the parts of their caps the
 * continuing wall does not hide stay visible (a step in thickness). Every other wall there is a
 * stem: both its edges run to the far face of the thinner through wall, so a T closes without
 * poking out of either. Returns false if no wall continues straight on.
 */
function joinThrough(ends: JunctionEnd[]): boolean {
  const pairs: [JunctionEnd, JunctionEnd][] = [];
  const paired = new Set<JunctionEnd>();
  for (const p of ends) {
    for (const q of ends) {
      if (p === q || paired.has(p) || paired.has(q)) continue;
      if (Math.abs(cross2(p.away, q.away)) >= COLLINEAR_SIN || dot2(p.away, q.away) >= 0) continue;
      pairs.push([p, q]);
      paired.add(p).add(q);
    }
  }
  if (pairs.length === 0) return false;
  for (const [p, q] of pairs) {
    const band = Math.min(p.half, q.half);
    p.covers = [{ w0: -band, w1: band, by: [q.id] }];
    q.covers = [{ w0: -band, w1: band, by: [p.id] }];
  }
  for (const stem of ends.filter((e) => !paired.has(e))) {
    const crossing = (pair: [JunctionEnd, JunctionEnd]): number =>
      Math.abs(cross2(stem.away, pair[0].away));
    const [p, q] = pairs.reduce((best, pair) => (crossing(pair) > crossing(best) ? pair : best));
    // Normal of the through walls pointing away from the stem: their far side.
    let far = leftOf(p.away);
    if (dot2(far, stem.away) > 0) far = [-far[0], -far[1]];
    const sin = -dot2(stem.away, far);
    if (sin < COLLINEAR_SIN) continue;
    const reach = Math.min(p.half, q.half);
    const toFarFace = (offset: number): number =>
      (reach - offset * dot2(leftOf(stem.away), far)) / sin;
    stem.extL = toFarFace(stem.half);
    stem.extR = toFarFace(-stem.half);
    stem.covers = [{ w0: -stem.half, w1: stem.half, by: [p.id, q.id] }];
  }
  return true;
}

/**
 * Mitre neighbouring walls around a junction: each edge runs to where it meets the facing edge of
 * the next wall round, so faces close without overlapping at any angle. Sorts `ends` by angle.
 */
function mitre(ends: JunctionEnd[]): void {
  const angle = (d: Vec2): number => Math.atan2(-d[1], d[0]);
  ends.sort((p, q) => angle(p.away) - angle(q.away));
  ends.forEach((e, i) => {
    const next = ends[(i + 1) % ends.length]!;
    const det = cross2(e.away, next.away);
    if (Math.abs(det) < COLLINEAR_SIN) return;
    // e's left edge (junction + half·left + λ·away) meets next's right edge (… − half·left + μ·away).
    const le = leftOf(e.away);
    const ln = leftOf(next.away);
    const r: Vec2 = [-next.half * ln[0] - e.half * le[0], -next.half * ln[1] - e.half * le[1]];
    // Never cut an edge back past the middle of its wall.
    e.extL = Math.max(-cross2(r, next.away) / det, -e.length / 2);
    next.extR = Math.max(-cross2(r, e.away) / det, -next.length / 2);
  });
}

/** The hub between mitred `ends` (sorted by angle) meeting at `point`. */
function junctionHub(point: Vec2, ends: readonly JunctionEnd[]): JunctionHub {
  const edgeEnd = (e: JunctionEnd, side: 1 | -1): Vec2 => {
    const l = leftOf(e.away);
    const ext = side === 1 ? e.extL : e.extR;
    return [
      point[0] + side * e.half * l[0] - ext * e.away[0],
      point[1] + side * e.half * l[1] - ext * e.away[1],
    ];
  };
  const sides = ends.map((e) => ({ wall: e.id, from: edgeEnd(e, -1), to: edgeEnd(e, 1) }));
  const ring = sides.flatMap((s) => [s.from, s.to]);
  const polygon = ring.filter((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length]!;
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > EPS;
  });
  const owner = ends.map((e) => e.id).sort()[0]!;
  return { owner, sides, polygon };
}

/** The end as seen in the wall's own frame. */
function toWallEnd(e: JunctionEnd, joiners: string[]): WallEnd {
  if (e.atA) return { extLeft: e.extL, extRight: e.extR, joiners, covers: e.covers };
  // Walking back along the wall from end b, its left side is the wall's right.
  return {
    extLeft: e.extR,
    extRight: e.extL,
    joiners,
    covers: e.covers.map((c) => ({ ...c, w0: -c.w1, w1: -c.w0 })),
  };
}

/**
 * For every wall, the walls sharing each end point and how to end it there. Ends within
 * {@link JOIN_TOLERANCE} meet. Walls continuing straight on end flat and stems run into them
 * (see `joinThrough`); otherwise neighbouring walls are mitred, and three or more of them get a
 * hub filling the middle. L-corners, T-junctions and crossings close without gaps or overlaps.
 */
export function computeWallJoins(
  walls: readonly Pick<Wall, 'id' | 'a' | 'b' | 'thickness'>[],
): WallJoins {
  const junctions: { point: Vec2; ends: JunctionEnd[] }[] = [];
  for (const w of walls) {
    const f = wallFrame(w.a, w.b);
    const back: Vec2 = [-f.dir[0], -f.dir[1]];
    for (const [point, away, atA] of [
      [w.a, f.dir, true],
      [w.b, back, false],
    ] as const) {
      const end: JunctionEnd = {
        id: w.id,
        atA,
        away,
        half: w.thickness / 2,
        length: f.length,
        extL: 0,
        extR: 0,
        covers: [],
      };
      const near = junctions.find(
        (j) => Math.hypot(j.point[0] - point[0], j.point[1] - point[1]) <= JOIN_TOLERANCE,
      );
      if (near) near.ends.push(end);
      else junctions.push({ point, ends: [end] });
    }
  }

  const hubs: JunctionHub[] = [];
  for (const { point, ends } of junctions) {
    if (ends.length < 2 || joinThrough(ends)) continue;
    mitre(ends);
    if (ends.length === 2) {
      const [p, q] = ends as [JunctionEnd, JunctionEnd];
      p.covers = [{ w0: -p.half, w1: p.half, by: [q.id] }];
      q.covers = [{ w0: -q.half, w1: q.half, by: [p.id] }];
    } else {
      for (const e of ends) e.covers = [{ w0: -e.half, w1: e.half, by: [] }];
      hubs.push(junctionHub(point, ends));
    }
  }

  const joins = new Map<string, Partial<WallJoin>>();
  for (const { ends } of junctions) {
    for (const e of ends) {
      const end = toWallEnd(
        e,
        ends.filter((o) => o !== e).map((o) => o.id),
      );
      joins.set(e.id, { ...joins.get(e.id), [e.atA ? 'a' : 'b']: end });
    }
  }
  return { joins: joins as Map<string, WallJoin>, hubs };
}

/**
 * The visible pieces of an end cap `half` wide over `span`: each band across the wall is open
 * where no cover over it applies, a cover applying at the heights all of its walls reach.
 */
export function capPieces(
  half: number,
  span: WallSpan,
  covers: readonly CapCover[],
  spans: ReadonlyMap<string, WallSpan | null>,
): CapPiece[] {
  const reach = (ids: readonly string[]): [number, number] | null => {
    let lo = -Infinity;
    let hi = Infinity;
    for (const id of ids) {
      const s = spans.get(id);
      if (!s) return null;
      lo = Math.max(lo, s.bottom);
      hi = Math.min(hi, s.top);
    }
    return lo < hi ? [lo, hi] : null;
  };
  const cuts = [-half, half, ...covers.flatMap((c) => [c.w0, c.w1])]
    .filter((w) => w >= -half && w <= half)
    .sort((p, q) => p - q);
  const pieces: CapPiece[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const w0 = cuts[i]!;
    const w1 = cuts[i + 1]!;
    if (w1 - w0 <= EPS) continue;
    const mid = (w0 + w1) / 2;
    const hidden = covers
      .filter((c) => c.w0 <= mid && mid <= c.w1)
      .map((c) => reach(c.by))
      .filter((r): r is [number, number] => r !== null);
    for (const [v0, v1] of uncoveredIntervals(span.bottom, span.top, hidden))
      pieces.push({ w0, w1, v0, v1 });
  }
  return pieces;
}

/**
 * Openings as holes in wall-local coordinates, sorted along the wall. Holes are kept at least
 * {@link MIN_PIER} inside `[uMin, uMax]` (the wall faces' common length), and dropped if nothing
 * is left of them.
 */
export function layoutHoles(
  openings: readonly Opening[],
  span: WallSpan,
  [uMin, uMax]: Vec2 = [-Infinity, Infinity],
): Hole[] {
  return openings
    .map((o) => {
      const v0 = span.threshold + o.sill;
      return {
        id: o.id,
        kind: o.kind,
        u0: Math.max(o.offset, uMin + MIN_PIER),
        u1: Math.min(o.offset + o.width, uMax - MIN_PIER),
        v0,
        v1: v0 + o.height,
        notch: v0 <= span.bottom + EPS,
      };
    })
    .filter((h) => h.u1 - h.u0 > EPS)
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
 * `capsA`/`capsB` are the end cap pieces that other walls do not hide; `stepped` holds the
 * openings that get steps, which fill the bottom of their hole instead of a sill.
 */
export function buildWallGeometry(
  wall: Wall,
  span: WallSpan,
  join: WallJoin,
  capsA: readonly CapPiece[],
  capsB: readonly CapPiece[],
  stepped: ReadonlySet<string> = new Set(),
): WallGeometry {
  const f = wallFrame(wall.a, wall.b);
  const half = wall.thickness / 2;
  // Each face runs between its own edge ends, which differ where an end is mitred.
  const extent = {
    left: [-join.a.extLeft, f.length + join.b.extLeft] as const,
    right: [-join.a.extRight, f.length + join.b.extRight] as const,
  };
  const holes = layoutHoles(wall.openings, span, [
    Math.max(extent.left[0], extent.right[0]),
    Math.min(extent.left[1], extent.right[1]),
  ]);
  const inner = holes
    .filter((h) => !h.notch)
    .map((h): Vec2[] => [
      [h.u0, h.v0],
      [h.u1, h.v0],
      [h.u1, h.v1],
      [h.u0, h.v1],
    ]);
  // Texture u follows the world along the wall, so collinear walls continue the same pattern,
  // and runs left to right for a viewer on each side.
  const s0 = f.origin[0] * f.dir[0] + f.origin[1] * f.dir[1];
  const face = (side: 'left' | 'right'): MeshData => {
    const sign = side === 'left' ? 1 : -1;
    const outline = wallOutline(...extent[side], span, holes);
    const ring = [...outline, ...inner.flat()];
    const mesh = emptyMesh();
    const points = ring.map(([u, v]) => framePoint(f, u, v, sign * half));
    const uvs = ring.map(([u, v]): Vec2 => [sign * -(s0 + u), v]);
    addFace(mesh, points, uvs, triangulate(outline, inner), frameAxis(f, 'w', sign));
    return mesh;
  };

  const edges = emptyMesh();
  const p = (u: number, v: number, w: number): Vec3 => framePoint(f, u, v, w);
  const [startL, endL] = extent.left;
  const [startR, endR] = extent.right;
  addQuad(
    edges,
    [
      p(startR, span.top, -half),
      p(endR, span.top, -half),
      p(endL, span.top, half),
      p(startL, span.top, half),
    ],
    [
      [startR, -half],
      [endR, -half],
      [endL, half],
      [startL, half],
    ],
    [0, 1, 0],
  );
  for (const [uR, uL, caps, sign] of [
    [startR, startL, capsA, -1],
    [endR, endL, capsB, 1],
  ] as const) {
    // The end runs from (uR, −half) to (uL, +half); its normal points out of the wall.
    const uAt = (w: number): number => uR + ((w + half) / (2 * half)) * (uL - uR);
    const nu = sign * 2 * half;
    const nw = -sign * (uL - uR);
    const len = Math.hypot(nu, nw);
    const normal: Vec3 = [
      (f.dir[0] * nu + f.left[0] * nw) / len,
      0,
      (f.dir[1] * nu + f.left[1] * nw) / len,
    ];
    for (const { w0, w1, v0, v1 } of caps) {
      addQuad(
        edges,
        [p(uAt(w0), v0, w0), p(uAt(w1), v0, w1), p(uAt(w1), v1, w1), p(uAt(w0), v1, w0)],
        [
          [w0, v0],
          [w1, v0],
          [w1, v1],
          [w0, v1],
        ],
        normal,
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
    const along = (v: number, w0: number, w1: number): Vec3[] => [
      p(h.u0, v, w0),
      p(h.u1, v, w0),
      p(h.u1, v, w1),
      p(h.u0, v, w1),
    ];
    const alongUv = (w0: number, w1: number): Vec2[] => [
      [h.u0, w0],
      [h.u1, w0],
      [h.u1, w1],
      [h.u0, w1],
    ];
    addQuad(mesh, along(h.v1, -half, half), alongUv(-half, half), [0, -1, 0]);
    // A sill unless the floors close the bottom: a notch sits on them, and at threshold level the
    // higher floor covers its half of the wall and the steps (if built) the lower half.
    const atThreshold = h.v0 <= span.threshold + EPS;
    if (!h.notch && !(atThreshold && stepped.has(h.id))) {
      const [w0, w1] =
        atThreshold && span.lower
          ? span.lower === 'left'
            ? [0, half]
            : [-half, 0]
          : [-half, half];
      addQuad(mesh, along(h.v0, w0, w1), alongUv(w0, w1), [0, 1, 0]);
    }
    reveals.set(h.id, mesh);
  }

  return { frame: f, holes, left: face('left'), right: face('right'), edges, reveals };
}

/**
 * The hub of a junction: a top at the highest wall top there, and sides wherever the hub stands
 * above or below the wall it touches.
 */
export function buildJunctionHub(
  hub: JunctionHub,
  spans: ReadonlyMap<string, WallSpan | null>,
): MeshData {
  const mesh = emptyMesh();
  const sides = hub.sides.flatMap((s) => {
    const span = spans.get(s.wall);
    return span ? [{ ...s, span }] : [];
  });
  if (sides.length === 0 || hub.polygon.length < 3) return mesh;
  const bottom = Math.min(...sides.map((s) => s.span.bottom));
  const top = Math.max(...sides.map((s) => s.span.top));
  addFace(
    mesh,
    hub.polygon.map(([x, z]): Vec3 => [x, top, z]),
    hub.polygon,
    triangulate(hub.polygon),
    [0, 1, 0],
  );
  const n = hub.polygon.length;
  const centre: Vec2 = [
    hub.polygon.reduce((s, q) => s + q[0], 0) / n,
    hub.polygon.reduce((s, q) => s + q[1], 0) / n,
  ];
  for (const { from, to, span } of sides) {
    const d: Vec2 = [to[0] - from[0], to[1] - from[1]];
    const len = Math.hypot(d[0], d[1]);
    if (len <= EPS) continue;
    let out = leftOf([d[0] / len, d[1] / len]);
    const mid: Vec2 = [(from[0] + to[0]) / 2 - centre[0], (from[1] + to[1]) / 2 - centre[1]];
    if (dot2(out, mid) < 0) out = [-out[0], -out[1]];
    for (const [v0, v1] of uncoveredIntervals(bottom, top, [[span.bottom, span.top]])) {
      addQuad(
        mesh,
        [
          [from[0], v0, from[1]],
          [to[0], v0, to[1]],
          [to[0], v1, to[1]],
          [from[0], v1, from[1]],
        ],
        [
          [0, v0],
          [len, v0],
          [len, v1],
          [0, v1],
        ],
        [out[0], 0, out[1]],
      );
    }
  }
  return mesh;
}
