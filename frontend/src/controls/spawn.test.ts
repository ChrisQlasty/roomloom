import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../engine/build/geometry-utils';
import { loadExampleScene } from '../engine/build/test-scene';
import { DOOR_SPAWN_DEPTH, roomCenter, spawnPose } from './spawn';

describe('spawnPose', () => {
  const scene = loadExampleScene();

  it("uses the project's spawn when set", () => {
    const pose = spawnPose(scene.shell, { position: [6, 0, 2], yaw_deg: 180 });
    expect(pose).toEqual({ position: [6, 0, 2], yawDeg: 180 });
  });

  it('otherwise stands just inside the first exterior door (by wall order), facing in', () => {
    // The corridor's side door: 1 m wide from z 9.1 down to 8.1 on the east wall (x = 30).
    const pose = spawnPose(scene.shell, null);
    expect(pose.position[0]).toBeCloseTo(30 - 0.15 - DOOR_SPAWN_DEPTH, 6);
    expect(pose.position[1]).toBe(0);
    expect(pose.position[2]).toBeCloseTo(8.6, 6);
    expect(pose.yawDeg).toBeCloseTo(270, 6);
  });

  it('faces into the room through a door on the north wall', () => {
    const shell = loadExampleScene().shell;
    shell.walls = shell.walls.filter((w) => w.id !== 'w_corridor_east');
    // The main entrance: 1.8 m wide from x 6.9 down to 5.1 on the north wall (z = 0).
    const pose = spawnPose(shell, null);
    expect(pose.position[0]).toBeCloseTo(6, 6);
    expect(pose.position[2]).toBeCloseTo(0.15 + DOOR_SPAWN_DEPTH, 6);
    expect(pose.yawDeg).toBeCloseTo(180, 6);
  });

  it('otherwise stands in the centre of the largest room', () => {
    const shell = loadExampleScene().shell;
    for (const wall of shell.walls) wall.openings = wall.openings.filter((o) => o.kind !== 'door');
    const pose = spawnPose(shell, undefined);
    // The L-shaped entrance hall (152 m²) beats the gym (80 m²); the point lies inside its wide part.
    const [x, , z] = pose.position;
    expect(x > 0 && x < 12 && z > 0 && z < 10).toBe(true);
    expect(pose.yawDeg).toBe(0);
  });

  it('uses the floor level of a sunken room', () => {
    const shell = loadExampleScene().shell;
    for (const wall of shell.walls) wall.openings = [];
    shell.rooms = shell.rooms.filter((r) => r.id === 'r_gym');
    expect(spawnPose(shell, null).position).toEqual([8, -0.34, 15]);
  });
});

describe('roomCenter', () => {
  it('is the vertex average for a convex room', () => {
    const square: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ];
    expect(roomCenter(square)).toEqual([2, 1]);
  });

  it('lies well inside a thin L, whose vertex average is outside', () => {
    const l: Vec2[] = [
      [0, 0],
      [10, 0],
      [10, 1],
      [1, 1],
      [1, 10],
      [0, 10],
    ];
    const [x, z] = roomCenter(l);
    const inside = (x > 0 && x < 10 && z > 0 && z < 1) || (x > 0 && x < 1 && z > 0 && z < 10);
    expect(inside).toBe(true);
    expect(Math.min(x, z)).toBeGreaterThan(0.3);
  });
});
