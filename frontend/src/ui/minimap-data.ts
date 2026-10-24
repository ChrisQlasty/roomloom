import type { GroundFocus } from '../controls/view-controls';
import {
  EPS,
  polygonContains,
  uncoveredIntervals,
  type Vec2,
} from '../engine/build/geometry-utils';
import {
  computeWallJoins,
  faceExtents,
  framePoint,
  holeRange,
  wallFrame,
  type WallFrame,
  type WallJoin,
} from '../engine/build/walls';
import type { Pin, Shell, Wall } from '../types/scene';

/** World metres from the centre of the minimap to its rim. */
export const MAP_RADIUS_M = 15;
/** The minimap redraws once the focus moves this far (metres) ... */
export const REDRAW_MOVE_M = 0.03;
/** ... or turns this far (degrees). */
export const REDRAW_TURN_DEG = 0.5;

/** A room as the minimap fills it. */
export interface MapRoom {
  id: string;
  polygon: readonly Vec2[];
  floorLevel: number;
}

/** A solid piece of wall (between openings, or the hub of a junction) as a plan polygon. */
export interface MapWall {
  polygon: Vec2[];
  /** Plan bounding box `[minX, minZ, maxX, maxZ]`, to skip pieces off the map. */
  box: [number, number, number, number];
}

/** The wall pieces of one thickness, drawn as one path. */
export interface MapWallGroup {
  thickness: number;
  pieces: MapWall[];
}

/** A plan line segment (a window's glass). */
export interface MapSegment {
  a: Vec2;
  b: Vec2;
}

/** Everything the minimap draws, in plan coordinates (world x, z). */
export interface MinimapData {
  rooms: MapRoom[];
  walls: MapWallGroup[];
  glass: MapSegment[];
  pins: Vec2[];
}

/** Plan point at `u` along and `w` across (left positive) the wall with frame `f`. */
function planPoint(f: WallFrame, u: number, w: number): Vec2 {
  const p = framePoint(f, u, 0, w);
  return [p[0], p[2]];
}

/** A wall piece over `polygon`. */
export function mapWall(polygon: Vec2[]): MapWall {
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  return { polygon, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] };
}

/**
 * The solid pieces of `wall`, the plan of its 3D geometry: each face runs between its own ends as
 * `join` gives them (flat, mitred, or into a through wall) and openings cut the same holes as in
 * 3D. Doors and passages leave gaps you can walk through; windows leave gaps that
 * {@link wallGlass} spans.
 */
export function wallPieces(wall: Wall, join: WallJoin): MapWall[] {
  const f = wallFrame(wall.a, wall.b);
  const half = wall.thickness / 2;
  const { left, right, shared } = faceExtents(f.length, join);
  const holes = wall.openings.map((o) => holeRange(o, shared)).filter((h) => h !== null);
  const lo = Math.min(left[0], right[0]);
  const hi = Math.max(left[1], right[1]);
  return uncoveredIntervals(lo, hi, holes).map(([from, to]) => {
    // A piece reaching an end of the wall takes each face's own end there.
    const [startL, startR] = from <= lo + EPS ? [left[0], right[0]] : [from, from];
    const [endL, endR] = to >= hi - EPS ? [left[1], right[1]] : [to, to];
    return mapWall([
      planPoint(f, startR, -half),
      planPoint(f, endR, -half),
      planPoint(f, endL, half),
      planPoint(f, startL, half),
    ]);
  });
}

/** The glass of every window in `wall`, along its centre line. */
export function wallGlass(wall: Wall): MapSegment[] {
  const f = wallFrame(wall.a, wall.b);
  return wall.openings
    .filter((o) => o.kind === 'window')
    .map((o) => ({ a: planPoint(f, o.offset, 0), b: planPoint(f, o.offset + o.width, 0) }));
}

/** The wall pieces and junction hubs of `shell`, grouped by thickness (a hub by its thinnest wall). */
function wallGroups(shell: Shell): MapWallGroup[] {
  const { joins, hubs } = computeWallJoins(shell.walls);
  const thickness = new Map(shell.walls.map((w) => [w.id, w.thickness]));
  const groups = new Map<number, MapWall[]>();
  const add = (t: number, pieces: MapWall[]): void => {
    groups.set(t, [...(groups.get(t) ?? []), ...pieces]);
  };
  for (const wall of shell.walls) add(wall.thickness, wallPieces(wall, joins.get(wall.id)!));
  for (const hub of hubs) {
    add(Math.min(...hub.sides.map((s) => thickness.get(s.wall)!)), [mapWall(hub.polygon)]);
  }
  return [...groups].map(([t, pieces]) => ({ thickness: t, pieces }));
}

/** What the minimap shows of `shell` and `pins` (placed pins only). */
export function minimapData(shell: Shell, pins: readonly Pin[]): MinimapData {
  return {
    rooms: shell.rooms.map((r) => ({ id: r.id, polygon: r.polygon, floorLevel: r.floor_level })),
    walls: wallGroups(shell),
    glass: shell.walls.flatMap(wallGlass),
    pins: pins.filter((p) => p.placed).map((p) => [p.position[0], p.position[2]] as const),
  };
}

/** Whether the plan box `box` reaches into the map around `focus`. */
export function onMap([x0, z0, x1, z1]: MapWall['box'], focus: GroundFocus): boolean {
  const dx = Math.max(x0 - focus.x, 0, focus.x - x1);
  const dz = Math.max(z0 - focus.z, 0, focus.z - z1);
  return Math.hypot(dx, dz) <= MAP_RADIUS_M;
}

/** The room containing plan point `point`, or null outside the building. */
export function roomAt(rooms: readonly MapRoom[], point: Vec2): MapRoom | null {
  return rooms.find((r) => polygonContains(r.polygon, point)) ?? null;
}

/**
 * The canvas transform `[a, b, c, d, e, f]` (as for `setTransform`) that draws plan coordinates
 * with `focus` at `center` (pixels), `scale` pixels per metre and the focus heading pointing up.
 */
export function mapTransform(
  focus: GroundFocus,
  scale: number,
  center: Vec2,
): [number, number, number, number, number, number] {
  // Plan x runs right and plan z (south) down, so north is up; then turn by −yaw.
  const yaw = (focus.yawDeg * Math.PI) / 180;
  const [a, b, c, d] = [
    scale * Math.cos(yaw),
    -scale * Math.sin(yaw),
    scale * Math.sin(yaw),
    scale * Math.cos(yaw),
  ];
  return [
    a,
    b,
    c,
    d,
    center[0] - (a * focus.x + c * focus.z),
    center[1] - (b * focus.x + d * focus.z),
  ];
}

/** Unit screen direction (x right, y down) of north on a map turned to `yawDeg`. */
export function northOnScreen(yawDeg: number): Vec2 {
  const yaw = (yawDeg * Math.PI) / 180;
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** Whether the map drawn at focus `drawn` is stale at `next` (null: never drawn). */
export function focusChanged(drawn: GroundFocus | null, next: GroundFocus): boolean {
  if (!drawn) return true;
  const turn = Math.abs(((((next.yawDeg - drawn.yawDeg) % 360) + 540) % 360) - 180);
  return Math.hypot(next.x - drawn.x, next.z - drawn.z) > REDRAW_MOVE_M || turn > REDRAW_TURN_DEG;
}
