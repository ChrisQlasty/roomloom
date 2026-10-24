import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../engine/build/geometry-utils';
import { loadExampleScene } from '../engine/build/test-scene';
import { framePoint, wallFrame } from '../engine/build/walls';
import type { Wall } from '../types/scene';
import { Colliders } from './collision';
import { exampleColliders, FRAME, hold, walkTo } from './test-world';
import {
  CAPSULE_RADIUS,
  CHILD_EYE_HEIGHT,
  EYE_HEIGHT,
  HEAD_BOB_DEPTH,
  PITCH_LIMIT_DEG,
  Walker,
} from './walk';

const scene = loadExampleScene();
const colliders = exampleColliders(scene);
const floorOf = new Map(scene.shell.rooms.map((r) => [r.id, r.floor_level]));

/** A walker standing still on the floor at plan point `at`. */
function standAt(at: Vec2, floor: number, world: Colliders = colliders): Walker {
  const walker = new Walker(world, { position: [at[0], floor, at[1]], yawDeg: 0 });
  hold(walker, {}, 0.2);
  return walker;
}

/** Plan point `w` metres from the centre line of `wall` (positive: left side) at `u` along it. */
function besideWall(wall: Wall, u: number, w: number): Vec2 {
  const p = framePoint(wallFrame(wall.a, wall.b), u, 0, w);
  return [p[0], p[2]];
}

/** Floor height on one side of a wall: its room's floor, or the ground (0) outside. */
function sideFloor(wall: Wall, side: 1 | -1): number {
  const room = side === 1 ? wall.left_room_id : wall.right_room_id;
  return room ? floorOf.get(room)! : 0;
}

describe('Walker on the example project', () => {
  it('settles on the floor at the spawn point', () => {
    const walker = standAt([6, 2], 0.5);
    hold(walker, {}, 0.5);
    expect(walker.grounded).toBe(true);
    expect(walker.feet.y).toBeCloseTo(0, 5);
    expect(walker.pose().position[1]).toBeCloseTo(EYE_HEIGHT, 3);
  });

  const doorways = scene.shell.walls.flatMap((wall) =>
    wall.openings.filter((o) => o.kind !== 'window').map((opening) => ({ wall, opening })),
  );

  it.each(doorways.flatMap((d) => [1, -1].map((from) => ({ ...d, from: from as 1 | -1 }))))(
    'walks through $opening.id from side $from to the other and stands on its floor',
    ({ wall, opening, from }) => {
      const u = opening.offset + opening.width / 2;
      const away = wall.thickness / 2 + 1;
      const walker = standAt(besideWall(wall, u, from * away), sideFloor(wall, from));
      for (const run of [false, true]) {
        const there = run ? from : (-from as 1 | -1);
        const { arrived } = walkTo(walker, besideWall(wall, u, there * away), { run });
        expect(arrived).toBe(true);
        hold(walker, {}, 0.3);
        expect(walker.grounded).toBe(true);
        expect(walker.feet.y).toBeCloseTo(sideFloor(wall, there), 3);
      }
    },
  );

  it('walks down and up the steps into the sunken gym, one tread at a time, without eye jumps', () => {
    const wall = scene.shell.walls.find((w) => w.id === 'w_hall_gym_north')!;
    const door = wall.openings[0]!;
    const u = door.offset + door.width / 2;
    const walker = standAt(besideWall(wall, u, 1.5), 0);
    const down = walkTo(walker, besideWall(wall, u, -1.5));
    expect(down.arrived).toBe(true);
    expect(walker.feet.y).toBeCloseTo(-0.34, 3);
    const heights = new Set(down.path.map((p) => Math.round(p.y * 100)));
    expect([...heights].sort((a, b) => b - a)).toEqual([0, -17, -34]);
    const up = walkTo(walker, besideWall(wall, u, 1.5));
    expect(up.arrived).toBe(true);
    expect(walker.feet.y).toBeCloseTo(0, 3);
    for (const eyes of [down.eyes, up.eyes]) {
      const jumps = eyes.slice(1).map((e, i) => Math.abs(e - eyes[i]!));
      expect(Math.max(...jumps)).toBeLessThan(0.05);
    }
  });

  /** Points on both sides of every wall, away from its ends and from door and passage holes. */
  const wallTargets = scene.shell.walls.flatMap((wall) => {
    const length = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const holes = wall.openings.filter((o) => o.kind !== 'window');
    const clearance = (u: number): number =>
      Math.min(u, length - u, ...holes.map((o) => Math.max(o.offset - u, u - o.offset - o.width)));
    let u = length / 2;
    for (let c = 0.5; c < length; c += 0.1) if (clearance(c) > clearance(u)) u = c;
    return [1, -1].map((side) => ({ id: wall.id, wall, u, side: side as 1 | -1 }));
  });

  it.each(wallTargets)(
    'does not pass through $id from side $side at running speed',
    ({ wall, u, side }) => {
      const walker = standAt(besideWall(wall, u, side * 1.2), sideFloor(wall, side));
      const target = besideWall(wall, u, -side * 1.2);
      const f = wallFrame(wall.a, wall.b);
      const distance = (): number =>
        side *
        ((walker.feet.x - f.origin[0]) * f.left[0] + (walker.feet.z - f.origin[1]) * f.left[1]);
      let closest = Infinity;
      walkTo(walker, target, { run: true, timeout: 1.5 });
      for (let t = 0; t < 1; t += FRAME) {
        walker.update(FRAME, { forward: 1, right: 0, run: true });
        closest = Math.min(closest, distance());
      }
      expect(closest).toBeGreaterThan(wall.thickness / 2 + CAPSULE_RADIUS - 0.02);
    },
  );
});

describe('Walker on a test floor', () => {
  /** A flat floor at y = 0 with a box of height `h` from x = 1 to 3. */
  function floorWithBox(h: number): Colliders {
    const world = new Colliders();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2));
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, h, 4));
    box.position.set(2, h / 2, 0);
    world.addColliders('floor', floor);
    world.addColliders('box', box);
    return world;
  }

  /** {@link floorWithBox} under a ceiling (facing down) at `height`. */
  function underCeiling(h: number, height: number): Colliders {
    const world = floorWithBox(h);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(Math.PI / 2));
    ceiling.position.y = height;
    world.addColliders('ceiling', ceiling);
    return world;
  }

  it('steps up onto a 0.3 m ledge', () => {
    const walker = standAt([0, 0], 0, floorWithBox(0.3));
    walker.yawDeg = 90;
    hold(walker, { forward: 1 }, 0.6);
    expect(walker.feet.x).toBeGreaterThan(1.5);
    expect(walker.feet.x).toBeLessThan(3);
    expect(walker.feet.y).toBeCloseTo(0.3, 3);
  });

  it('is blocked by a 0.5 m ledge', () => {
    const walker = standAt([0, 0], 0, floorWithBox(0.5));
    walker.yawDeg = 90;
    hold(walker, { forward: 1, run: true }, 1.5);
    // The capsule's lower sphere touches the ledge's top edge, slightly past its side face.
    expect(walker.feet.x).toBeLessThan(1 - CAPSULE_RADIUS + 0.04);
    expect(walker.feet.y).toBeCloseTo(0, 3);
  });

  it('does not step up where the head would hit the ceiling', () => {
    // 2.05 m clears the walker on the floor (1.86 m) but not on the 0.3 m ledge (2.16 m).
    const walker = standAt([0, 0], 0, underCeiling(0.3, 2.05));
    walker.yawDeg = 90;
    hold(walker, { forward: 1 }, 1);
    expect(walker.feet.x).toBeLessThan(1);
    expect(walker.feet.y).toBeCloseTo(0, 3);
    // With more headroom the same ledge is climbed.
    const tall = standAt([0, 0], 0, underCeiling(0.3, 2.3));
    tall.yawDeg = 90;
    hold(tall, { forward: 1 }, 0.6);
    expect(tall.feet.y).toBeCloseTo(0.3, 3);
  });

  it('can walk out from under a ceiling it already touches', () => {
    const walker = standAt([0, 0], 0, underCeiling(0, 1.8));
    walker.yawDeg = 90;
    hold(walker, { forward: 1 }, 0.5);
    expect(walker.feet.x).toBeGreaterThan(1);
  });

  it('bobs the eye a little while walking, and not while standing', () => {
    const walker = standAt([-5, 0], 0, floorWithBox(0.3));
    walker.yawDeg = 180;
    const eyes: number[] = [];
    for (let t = 0; t < 2; t += FRAME) {
      hold(walker, { forward: 1 }, FRAME);
      eyes.push(walker.pose().position[1]);
    }
    const walking = eyes.slice(30);
    expect(Math.max(...walking)).toBeLessThanOrEqual(EYE_HEIGHT + 1e-9);
    expect(Math.min(...walking)).toBeLessThan(EYE_HEIGHT - HEAD_BOB_DEPTH * 0.9);
    const steps = eyes.slice(1).map((e, i) => Math.abs(e - eyes[i]!));
    expect(Math.max(...steps)).toBeLessThan(0.01);
    hold(walker, {}, 1.5);
    expect(walker.pose().position[1]).toBeCloseTo(EYE_HEIGHT, 4);
  });

  it('respawns after falling out of the world', () => {
    const walker = new Walker(new Colliders(), { position: [1, 0, 2], yawDeg: 90 });
    hold(walker, {}, 4);
    expect(walker.feet.y).toBeGreaterThan(-30);
  });

  it('clamps pitch to ±85° and wraps yaw', () => {
    const walker = new Walker(new Colliders(), { position: [0, 0, 0], yawDeg: 350 });
    walker.look(200, -10_000);
    expect(walker.pitchDeg).toBe(PITCH_LIMIT_DEG);
    walker.look(0, 20_000);
    expect(walker.pitchDeg).toBe(-PITCH_LIMIT_DEG);
    expect(walker.yawDeg).toBeCloseTo(14, 6);
  });

  it('tweens the eye to the child height and back', () => {
    const walker = standAt([0, 0], 0, floorWithBox(0.3));
    walker.toggleChildView();
    expect(walker.childView).toBe(true);
    const eyes: number[] = [];
    for (let t = 0; t < 0.4; t += FRAME) {
      hold(walker, {}, FRAME);
      eyes.push(walker.pose().position[1]);
    }
    expect(eyes.at(-1)).toBeCloseTo(CHILD_EYE_HEIGHT, 6);
    const steps = eyes.slice(1).map((e, i) => eyes[i]! - e);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    // Eased: no frame covers more than an eighth of the drop.
    expect(Math.max(...steps)).toBeLessThan((EYE_HEIGHT - CHILD_EYE_HEIGHT) / 8);
    walker.toggleChildView();
    hold(walker, {}, 0.4);
    expect(walker.pose().position[1]).toBeCloseTo(EYE_HEIGHT, 6);
  });
});
