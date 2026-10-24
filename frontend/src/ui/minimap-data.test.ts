import { describe, expect, it } from 'vitest';
import { exampleColliders, hold, walkTo } from '../controls/test-world';
import { roomCenter } from '../controls/spawn';
import { Walker } from '../controls/walk';
import type { Vec2 } from '../engine/build/geometry-utils';
import { loadExampleScene } from '../engine/build/test-scene';
import { framePoint, wallFrame } from '../engine/build/walls';
import type { Wall } from '../types/scene';
import {
  focusChanged,
  mapTransform,
  minimapData,
  northOnScreen,
  REDRAW_MOVE_M,
  roomAt,
  wallGlass,
  wallPieces,
  type MapSegment,
} from './minimap-data';

const scene = loadExampleScene();
const data = minimapData(scene.shell, scene.pins);

/** Distance from plan point `p` to segment `s`. */
function distanceToSegment([px, pz]: Vec2, { a, b }: MapSegment): number {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - (a[0] + t * dx), pz - (a[1] + t * dz));
}

/** Plan point `w` metres from the centre line of `wall` (positive: left side) at `u` along it. */
function besideWall(wall: Wall, u: number, w: number): Vec2 {
  const p = framePoint(wallFrame(wall.a, wall.b), u, 0, w);
  return [p[0], p[2]];
}

/** `segments` with coordinates rounded to micrometres, to compare without float noise. */
const rounded = <T extends MapSegment>(segments: T[]): T[] =>
  segments.map((s) => ({
    ...s,
    a: s.a.map((v) => Math.round(v * 1e6) / 1e6),
    b: s.b.map((v) => Math.round(v * 1e6) / 1e6),
  }));

const wallLength = (w: Wall): number => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

describe('wall pieces', () => {
  const wall: Wall = {
    id: 'w',
    a: [0, 0],
    b: [10, 0],
    thickness: 0.3,
    kind: 'exterior',
    left_room_id: 'r',
    right_room_id: null,
    face_overrides: {},
    openings: [
      { id: 'd', kind: 'door', offset: 2, width: 1, height: 2.1, sill: 0 },
      { id: 'g', kind: 'window', offset: 5, width: 1.5, height: 1.2, sill: 0.9 },
    ],
  } as unknown as Wall;

  it('leaves a gap at every opening and runs half a thickness past the wall ends', () => {
    expect(rounded(wallPieces(wall))).toEqual([
      { a: [-0.15, 0], b: [2, 0], thickness: 0.3 },
      { a: [3, 0], b: [5, 0], thickness: 0.3 },
      { a: [6.5, 0], b: [10.15, 0], thickness: 0.3 },
    ]);
  });

  it('spans windows with glass, not doors', () => {
    expect(rounded(wallGlass(wall))).toEqual([{ a: [5, 0], b: [6.5, 0] }]);
  });

  it('keeps an opening at a wall end open there', () => {
    const atEnd = { ...wall, openings: [{ ...wall.openings[0]!, offset: 0 }] };
    expect(rounded(wallPieces(atEnd))).toEqual([{ a: [1, 0], b: [10.15, 0], thickness: 0.3 }]);
  });

  it.each(scene.shell.walls)('$id: solid exactly where the 3D wall has no hole', (w) => {
    const pieces = wallPieces(w);
    for (let u = 0.05; u < wallLength(w); u += 0.1) {
      const point = besideWall(w, u, 0);
      const inHole = w.openings.some((o) => u > o.offset && u < o.offset + o.width);
      const onMap = pieces.some((p) => distanceToSegment(point, p) < 1e-9);
      expect(onMap).toBe(!inHole);
    }
  });
});

describe('minimap data of the example', () => {
  it('has every room, glass for every window and only placed pins', () => {
    const pins = [...scene.pins, { ...scene.pins[0]!, id: 'loose', placed: false }];
    const d = minimapData(scene.shell, pins);
    expect(d.rooms.map((r) => r.id)).toEqual(scene.shell.rooms.map((r) => r.id));
    expect(d.glass).toHaveLength(10);
    expect(d.pins).toEqual([[scene.pins[0]!.position[0], scene.pins[0]!.position[2]]]);
  });

  it('finds the room at a point, and none outside', () => {
    for (const room of scene.shell.rooms) {
      expect(roomAt(data.rooms, roomCenter(room.polygon))?.id).toBe(room.id);
    }
    expect(roomAt(data.rooms, [-5, -5])).toBeNull();
  });

  const doorways = scene.shell.walls.flatMap((wall) =>
    wall.openings.filter((o) => o.kind !== 'window').map((opening) => ({ wall, opening })),
  );
  const colliders = exampleColliders(scene);
  const floorOf = new Map(scene.shell.rooms.map((r) => [r.id, r.floor_level]));

  it.each(doorways)(
    'a walk through $opening.id crosses the gap on the map, touching no wall stroke',
    ({ wall, opening }) => {
      const u = opening.offset + opening.width / 2;
      const away = wall.thickness / 2 + 1;
      const floor = wall.left_room_id ? floorOf.get(wall.left_room_id)! : 0;
      const start = besideWall(wall, u, away);
      const walker = new Walker(colliders, { position: [start[0], floor, start[1]], yawDeg: 0 });
      hold(walker, {}, 0.2);
      const { path, arrived } = walkTo(walker, besideWall(wall, u, -away));
      expect(arrived).toBe(true);
      for (const p of path) {
        for (const piece of data.walls) {
          expect(distanceToSegment([p.x, p.z], piece)).toBeGreaterThan(piece.thickness / 2);
        }
      }
    },
  );
});

describe('map transform', () => {
  const apply = (m: number[], [x, z]: Vec2): Vec2 => [
    m[0]! * x + m[2]! * z + m[4]!,
    m[1]! * x + m[3]! * z + m[5]!,
  ];

  it.each([0, 37, 90, 180, 271])(
    'puts the focus at the centre and its heading up (yaw %i°)',
    (yaw) => {
      const focus = { x: 4, z: -2, yawDeg: yaw };
      const m = mapTransform(focus, 10, [100, 100]);
      const rad = (yaw * Math.PI) / 180;
      const ahead = apply(m, [4 + Math.sin(rad), -2 - Math.cos(rad)]);
      const right = apply(m, [4 + Math.cos(rad), -2 + Math.sin(rad)]);
      expect(apply(m, [4, -2])[0]).toBeCloseTo(100);
      expect(apply(m, [4, -2])[1]).toBeCloseTo(100);
      expect(ahead[0]).toBeCloseTo(100);
      expect(ahead[1]).toBeCloseTo(90);
      expect(right[0]).toBeCloseTo(110);
      expect(right[1]).toBeCloseTo(100);
    },
  );

  it('places north on the rim where north lies', () => {
    const [x0, y0] = northOnScreen(0);
    const [x90, y90] = northOnScreen(90);
    expect(x0).toBeCloseTo(0);
    expect(y0).toBeCloseTo(-1);
    expect(x90).toBeCloseTo(-1);
    expect(y90).toBeCloseTo(0);
    const m = mapTransform({ x: 0, z: 0, yawDeg: 123 }, 1, [0, 0]);
    const [nx, ny] = northOnScreen(123);
    expect(apply(m, [0, -1])[0]).toBeCloseTo(nx);
    expect(apply(m, [0, -1])[1]).toBeCloseTo(ny);
  });
});

describe('redraw threshold', () => {
  const at = { x: 1, z: 1, yawDeg: 359.9 };

  it('redraws the first time, after a move or a turn, and not for tiny changes', () => {
    expect(focusChanged(null, at)).toBe(true);
    expect(focusChanged(at, { ...at, x: 1 + REDRAW_MOVE_M / 2 })).toBe(false);
    expect(focusChanged(at, { ...at, yawDeg: 0.1 })).toBe(false);
    expect(focusChanged(at, { ...at, z: 1 + REDRAW_MOVE_M * 2 })).toBe(true);
    expect(focusChanged(at, { ...at, yawDeg: 1 })).toBe(true);
  });
});
