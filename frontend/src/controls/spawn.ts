import { polygonArea, type Vec2, type Vec3 } from '../engine/build/geometry-utils';
import { frameAxis, framePoint, wallFrame } from '../engine/build/walls';
import type { Spawn } from '../types/project';
import type { Room, Shell } from '../types/scene';
import { yawOf } from './pose';

/** How far inside the wall face a door spawn stands, in metres. */
export const DOOR_SPAWN_DEPTH = 0.8;
/** Grid cells per side when searching a concave room for a point well inside it. */
const INTERIOR_GRID = 24;

/** Where a visitor starts: feet position (world metres) and view direction. */
export interface SpawnPose {
  position: Vec3;
  yawDeg: number;
}

function contains(polygon: readonly Vec2[], [x, z]: Vec2): boolean {
  let inside = false;
  polygon.forEach(([x0, z0], i) => {
    const [x1, z1] = polygon[(i + 1) % polygon.length]!;
    if (z0 > z !== z1 > z && x < ((x1 - x0) * (z - z0)) / (z1 - z0) + x0) inside = !inside;
  });
  return inside;
}

function distanceToEdges(polygon: readonly Vec2[], [x, z]: Vec2): number {
  let best = Infinity;
  polygon.forEach(([x0, z0], i) => {
    const [x1, z1] = polygon[(i + 1) % polygon.length]!;
    const [dx, dz] = [x1 - x0, z1 - z0];
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - x0 - t * dx, z - z0 - t * dz));
  });
  return best;
}

/**
 * The centre of a room: the vertex average if it lies inside and at least half as far from the
 * walls as the grid point farthest from them, else that grid point (for concave rooms such as an L).
 */
export function roomCenter(polygon: readonly Vec2[]): Vec2 {
  const n = polygon.length;
  const mean: Vec2 = [
    polygon.reduce((s, p) => s + p[0], 0) / n,
    polygon.reduce((s, p) => s + p[1], 0) / n,
  ];
  const xs = polygon.map((p) => p[0]);
  const zs = polygon.map((p) => p[1]);
  const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
  const step = Math.max(Math.max(...xs) - x0, Math.max(...zs) - z0) / INTERIOR_GRID;
  let best = mean;
  let bestDistance = -1;
  for (let i = 0; i <= INTERIOR_GRID; i++) {
    for (let j = 0; j <= INTERIOR_GRID; j++) {
      const p: Vec2 = [x0 + i * step, z0 + j * step];
      if (!contains(polygon, p)) continue;
      const d = distanceToEdges(polygon, p);
      if (d > bestDistance) [best, bestDistance] = [p, d];
    }
  }
  const meanDistance = contains(polygon, mean) ? distanceToEdges(polygon, mean) : -1;
  return meanDistance * 2 >= bestDistance ? mean : best;
}

/** Just inside the first exterior door (by wall order), facing into the room; null if none. */
function doorSpawn(shell: Shell, rooms: Map<string, Room>): SpawnPose | null {
  for (const wall of shell.walls) {
    if (wall.kind !== 'exterior') continue;
    const door = wall.openings.find((o) => o.kind === 'door');
    const room = rooms.get(wall.left_room_id ?? wall.right_room_id ?? '');
    if (!door || !room) continue;
    const f = wallFrame(wall.a, wall.b);
    const into = wall.left_room_id === room.id ? 1 : -1;
    const depth = into * (wall.thickness / 2 + DOOR_SPAWN_DEPTH);
    const position = framePoint(f, door.offset + door.width / 2, room.floor_level, depth);
    const [dx, , dz] = frameAxis(f, 'w', into);
    return { position, yawDeg: yawOf(dx, dz) };
  }
  return null;
}

/**
 * The start pose: the project's `spawn` if set, otherwise just inside the first exterior door,
 * otherwise the centre of the largest room facing north.
 */
export function spawnPose(shell: Shell, spawn: Spawn | null | undefined): SpawnPose {
  if (spawn) return { position: spawn.position, yawDeg: spawn.yaw_deg };
  const rooms = new Map(shell.rooms.map((r) => [r.id, r]));
  const atDoor = doorSpawn(shell, rooms);
  if (atDoor) return atDoor;
  const largest = shell.rooms.reduce((a, b) =>
    polygonArea(b.polygon) > polygonArea(a.polygon) ? b : a,
  );
  const [x, z] = roomCenter(largest.polygon);
  return { position: [x, largest.floor_level, z], yawDeg: 0 };
}
