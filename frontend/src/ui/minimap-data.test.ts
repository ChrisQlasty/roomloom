import { describe, expect, it } from 'vitest';
import { exampleColliders, hold, walkTo } from '../controls/test-world';
import { roomCenter } from '../controls/spawn';
import { Walker } from '../controls/walk';
import { polygonContains, type Vec2 } from '../engine/build/geometry-utils';
import { loadExampleScene } from '../engine/build/test-scene';
import {
  computeWallJoins,
  framePoint,
  MIN_PIER,
  wallFrame,
  type WallJoin,
} from '../engine/build/walls';
import type { Wall } from '../types/scene';
import {
  focusChanged,
  MAP_RADIUS_M,
  mapTransform,
  minimapData,
  northOnScreen,
  onMap,
  REDRAW_MOVE_M,
  roomAt,
  wallGlass,
  wallPieces,
  type MapSegment,
  type MapWall,
} from './minimap-data';

const scene = loadExampleScene();
const data = minimapData(scene.shell, scene.pins);
const pieces = data.walls.flatMap((g) => g.pieces);
const joins = computeWallJoins(scene.shell.walls).joins;

/** Plan point `w` metres from the centre line of `wall` (positive: left side) at `u` along it. */
function besideWall(wall: Wall, u: number, w: number): Vec2 {
  const p = framePoint(wallFrame(wall.a, wall.b), u, 0, w);
  return [p[0], p[2]];
}

const round = (p: Vec2): number[] => p.map((v) => Math.round(v * 1e6) / 1e6 + 0);

/** `segments` with coordinates rounded to micrometres, to compare without float noise. */
const rounded = (segments: MapSegment[]): { a: number[]; b: number[] }[] =>
  segments.map((s) => ({ a: round(s.a), b: round(s.b) }));

/** The polygons of `walls`, rounded likewise. */
const polygons = (walls: MapWall[]): number[][][] => walls.map((w) => w.polygon.map(round));

/** Whether plan point `p` lies inside any of `walls`. */
const covered = (walls: MapWall[], p: Vec2): boolean =>
  walls.some((w) => polygonContains(w.polygon, p));

/** Ends meeting nothing: the wall stops flat at its end points. */
const freeEnds: WallJoin = {
  a: { extLeft: 0, extRight: 0, joiners: [], covers: [] },
  b: { extLeft: 0, extRight: 0, joiners: [], covers: [] },
};

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

  it('leaves a gap at every opening and ends flat at free ends', () => {
    // Walking a→b east, the left side is north (−Z).
    expect(polygons(wallPieces(wall, freeEnds))).toEqual([
      [
        [0, 0.15],
        [2, 0.15],
        [2, -0.15],
        [0, -0.15],
      ],
      [
        [3, 0.15],
        [5, 0.15],
        [5, -0.15],
        [3, -0.15],
      ],
      [
        [6.5, 0.15],
        [10, 0.15],
        [10, -0.15],
        [6.5, -0.15],
      ],
    ]);
  });

  it('spans windows with glass, not doors', () => {
    expect(rounded(wallGlass(wall))).toEqual([{ a: [5, 0], b: [6.5, 0] }]);
  });

  it('keeps an opening at a wall end open there, but for the pier the 3D wall keeps', () => {
    const atEnd = { ...wall, openings: [{ ...wall.openings[0]!, offset: 0 }] };
    expect(polygons(wallPieces(atEnd, freeEnds))).toEqual([
      [
        [0, 0.15],
        [MIN_PIER, 0.15],
        [MIN_PIER, -0.15],
        [0, -0.15],
      ],
      [
        [1, 0.15],
        [10, 0.15],
        [10, -0.15],
        [1, -0.15],
      ],
    ]);
  });

  it('does not reach into a door at the start of a wall continuing straight on', () => {
    const next: Wall = {
      ...wall,
      id: 'next',
      a: [10, 0],
      b: [15, 0],
      openings: [{ ...wall.openings[0]!, offset: 0 }],
    };
    const { joins: j } = computeWallJoins([wall, next]);
    const both = [...wallPieces(wall, j.get('w')!), ...wallPieces(next, j.get('next')!)];
    expect(covered(both, [10 + MIN_PIER / 2, 0])).toBe(true);
    for (const x of [10.05, 10.5, 10.95]) expect(covered(both, [x, 0.1])).toBe(false);
  });

  it('closes a corner of unequal walls without running past the thinner one', () => {
    const thin: Wall = {
      ...wall,
      id: 'thin',
      a: [10, 0],
      b: [10, 5],
      thickness: 0.12,
      openings: [],
    };
    const { joins: j } = computeWallJoins([wall, thin]);
    const both = [...wallPieces(wall, j.get('w')!), ...wallPieces(thin, j.get('thin')!)];
    // The outer corner (east of the thin wall, north of the thick one) is filled, nothing beyond.
    expect(covered(both, [10.05, -0.14])).toBe(true);
    expect(covered(both, [10.07, -0.1])).toBe(false);
    expect(covered(both, [10.05, -0.16])).toBe(false);
  });

  it.each(scene.shell.walls)('$id: solid exactly where the 3D wall has no hole', (w) => {
    const own = wallPieces(w, joins.get(w.id)!);
    for (let u = 0.05; u < wallLength(w); u += 0.1) {
      const inHole = w.openings.some((o) => u > o.offset && u < o.offset + o.width);
      expect(covered(own, besideWall(w, u, 0))).toBe(!inHole);
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
      for (const p of path) expect(covered(pieces, [p.x, p.z])).toBe(false);
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

describe('map culling', () => {
  const box: MapWall['box'] = [0, 0, 2, 1];

  it('keeps pieces reaching into the map and drops those beyond its rim', () => {
    expect(onMap(box, { x: 1, z: 0.5, yawDeg: 0 })).toBe(true);
    expect(onMap(box, { x: 2 + MAP_RADIUS_M - 0.01, z: 0.5, yawDeg: 0 })).toBe(true);
    expect(onMap(box, { x: 2 + MAP_RADIUS_M + 0.01, z: 0.5, yawDeg: 0 })).toBe(false);
    const corner = MAP_RADIUS_M / Math.SQRT2 + 0.01;
    expect(onMap(box, { x: 2 + corner, z: 1 + corner, yawDeg: 0 })).toBe(false);
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
