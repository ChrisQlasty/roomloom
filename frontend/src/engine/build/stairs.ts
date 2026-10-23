import type { Opening, Room, Transition, Wall } from '../../types/scene';
import {
  addFace,
  addQuad,
  EPS,
  emptyMesh,
  triangulate,
  type MeshData,
  type Vec2,
} from './geometry-utils';
import { frameAxis, framePoint, wallFrame } from './walls';

/** Depth of one tread in metres. */
export const TREAD_DEPTH = 0.3;

/**
 * Side profile of a flight of steps as (s, y) points, counter-clockwise: s runs from the wall
 * centre line (0) into the host room, y is world height. The top tread starts at the centre line
 * (it fills the lower half of the threshold) and reaches `faceS + TREAD_DEPTH`; each further tread
 * is `TREAD_DEPTH` deep and one riser (`rise / steps`) lower, the last riser ending on `lower`.
 */
export function stairProfile(steps: number, upper: number, lower: number, faceS: number): Vec2[] {
  const riser = (upper - lower) / steps;
  const points: Vec2[] = [[0, lower]];
  const end = faceS + steps * TREAD_DEPTH;
  points.push([end, lower]);
  for (let k = steps - 1; k >= 0; k--) {
    const s = faceS + (k + 1) * TREAD_DEPTH;
    const y = upper - k * riser;
    points.push([s, y], [k === 0 ? 0 : s - TREAD_DEPTH, y]);
  }
  return points;
}

/** Whether {@link buildStairs} builds steps: it needs at least one, in a host room below `threshold`. */
export function hasStairs(transition: Transition, host: Room, threshold: number): boolean {
  return transition.steps >= 1 && host.floor_level <= threshold - EPS;
}

/**
 * Steps for `transition`, built in its host room in front of the opening, as wide as the opening.
 * They climb from the host floor to the threshold (the higher floor beside the wall), with
 * `rise_total / steps` risers. Returns null if the host room is not the lower side.
 */
export function buildStairs(
  transition: Transition,
  wall: Wall,
  opening: Opening,
  host: Room,
  threshold: number,
): MeshData | null {
  const upper = threshold;
  const lower = upper - transition.rise_total;
  if (!hasStairs(transition, host, threshold)) return null;
  const f = wallFrame(wall.a, wall.b);
  const into = wall.left_room_id === host.id ? 1 : -1;
  const profile = stairProfile(transition.steps, upper, lower, wall.thickness / 2);
  const u0 = opening.offset;
  const u1 = opening.offset + opening.width;
  const p = (u: number, [s, y]: Vec2): readonly [number, number, number] =>
    framePoint(f, u, y, into * s);
  const mesh = emptyMesh();

  const sides = triangulate(profile);
  for (const [u, sign] of [
    [u0, -1],
    [u1, 1],
  ] as const) {
    addFace(
      mesh,
      profile.map((pt) => p(u, pt)),
      profile,
      sides,
      frameAxis(f, 'u', sign),
    );
  }
  // Treads and risers: the profile edges facing up or into the room (not the floor or wall side).
  profile.forEach((from, i) => {
    const to = profile[(i + 1) % profile.length]!;
    const ds = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(ds, dy);
    const ns = dy / len;
    const ny = -ds / len;
    if (ns <= EPS && ny <= EPS) return;
    const intoAxis = frameAxis(f, 'w', into);
    addQuad(
      mesh,
      [p(u0, from), p(u1, from), p(u1, to), p(u0, to)],
      [
        [u0, 0],
        [u1, 0],
        [u1, len],
        [u0, len],
      ],
      [intoAxis[0] * ns, ny, intoAxis[2] * ns],
    );
  });
  return mesh;
}
