import { polygonContains, uncoveredIntervals, type Vec2 } from '../engine/build/geometry-utils';
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

/** A solid piece of wall between openings: a stroke along the centre line, `thickness` wide. */
export interface MapWall {
  a: Vec2;
  b: Vec2;
  thickness: number;
}

/** A plan line segment (a window's glass). */
export interface MapSegment {
  a: Vec2;
  b: Vec2;
}

/** Everything the minimap draws, in plan coordinates (world x, z). */
export interface MinimapData {
  rooms: MapRoom[];
  walls: MapWall[];
  glass: MapSegment[];
  pins: Vec2[];
}

/** Where the minimap is centred and which way is up: a plan point and a heading (schema yaw). */
export interface MapFocus {
  x: number;
  z: number;
  yawDeg: number;
}

function along(wall: Wall, u: number): Vec2 {
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const t = u / length;
  return [wall.a[0] + (wall.b[0] - wall.a[0]) * t, wall.a[1] + (wall.b[1] - wall.a[1]) * t];
}

/**
 * The solid pieces of `wall`: its centre line minus every opening. Doors and passages leave gaps
 * you can walk through; windows leave gaps that {@link wallGlass} spans. Pieces that reach an end
 * of the wall run half a thickness past it, so strokes close the corners and T-junctions.
 */
export function wallPieces(wall: Wall): MapWall[] {
  const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const holes = wall.openings.map((o) => [o.offset, o.offset + o.width] as const);
  const half = wall.thickness / 2;
  return uncoveredIntervals(0, length, holes).map(([from, to]) => ({
    a: along(wall, from > 0 ? from : -half),
    b: along(wall, to < length ? to : length + half),
    thickness: wall.thickness,
  }));
}

/** The glass of every window in `wall`, along its centre line. */
export function wallGlass(wall: Wall): MapSegment[] {
  return wall.openings
    .filter((o) => o.kind === 'window')
    .map((o) => ({ a: along(wall, o.offset), b: along(wall, o.offset + o.width) }));
}

/** What the minimap shows of `shell` and `pins` (placed pins only). */
export function minimapData(shell: Shell, pins: readonly Pin[]): MinimapData {
  return {
    rooms: shell.rooms.map((r) => ({ id: r.id, polygon: r.polygon, floorLevel: r.floor_level })),
    walls: shell.walls.flatMap(wallPieces),
    glass: shell.walls.flatMap(wallGlass),
    pins: pins.filter((p) => p.placed).map((p) => [p.position[0], p.position[2]] as const),
  };
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
  focus: MapFocus,
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
export function focusChanged(drawn: MapFocus | null, next: MapFocus): boolean {
  if (!drawn) return true;
  const turn = Math.abs(((((next.yawDeg - drawn.yawDeg) % 360) + 540) % 360) - 180);
  return Math.hypot(next.x - drawn.x, next.z - drawn.z) > REDRAW_MOVE_M || turn > REDRAW_TURN_DEG;
}
