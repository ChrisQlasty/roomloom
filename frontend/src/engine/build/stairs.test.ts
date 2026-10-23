import { describe, expect, it } from 'vitest';
import type { MeshData } from './geometry-utils';
import { buildStairs, stairProfile, TREAD_DEPTH } from './stairs';
import { loadExampleScene } from './test-scene';

function bounds(mesh: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, mesh.positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, mesh.positions[i]!);
  }
  return { min, max };
}

describe('stairProfile', () => {
  it('has equal risers of rise / steps and treads TREAD_DEPTH deep', () => {
    const profile = stairProfile(3, 0, -0.51, 0.06);
    expect(profile).toHaveLength(2 + 2 * 3);
    // Tread heights, top first, and where each tread starts.
    const treads = profile.slice(2).filter((_, i) => i % 2 === 1);
    expect(treads.map(([, y]) => y).reverse()).toEqual([
      expect.closeTo(0, 9),
      expect.closeTo(-0.17, 9),
      expect.closeTo(-0.34, 9),
    ]);
    // The top tread starts at the wall centre line; the others are one tread deep.
    const fronts = profile.slice(2).filter((_, i) => i % 2 === 0);
    expect(fronts.map(([s]) => s).reverse()).toEqual([
      expect.closeTo(0.06 + TREAD_DEPTH, 9),
      expect.closeTo(0.06 + 2 * TREAD_DEPTH, 9),
      expect.closeTo(0.06 + 3 * TREAD_DEPTH, 9),
    ]);
    expect(profile[0]).toEqual([0, -0.51]);
    expect(profile[1]).toEqual([expect.closeTo(0.96, 9), -0.51]);
    expect(profile.at(-1)).toEqual([0, 0]);
  });

  it('is counter-clockwise in (s, y)', () => {
    const profile = stairProfile(2, 0, -0.34, 0.06);
    const area = profile.reduce((sum, [s, y], i) => {
      const [s2, y2] = profile[(i + 1) % profile.length]!;
      return sum + s * y2 - s2 * y;
    }, 0);
    expect(area).toBeGreaterThan(0);
  });
});

describe('buildStairs', () => {
  const { shell } = loadExampleScene();
  const transition = shell.transitions[0]!;
  const wall = shell.walls.find((w) => w.id === 'w_hall_gym_north')!;
  const opening = wall.openings[0]!;
  const gym = shell.rooms.find((r) => r.id === 'r_gym')!;
  const hall = shell.rooms.find((r) => r.id === 'r_entrance_hall')!;

  it('builds the gym steps in the gym, in front of the door, from its floor up to the threshold', () => {
    const mesh = buildStairs(transition, wall, opening, gym, 0)!;
    const { min, max } = bounds(mesh);
    // Door: wall (4,10)→(12,10), offset 3, width 1.6. The gym lies south (+Z) of it.
    expect(min[0]).toBeCloseTo(7);
    expect(max[0]).toBeCloseTo(8.6);
    expect(min[1]).toBeCloseTo(-0.34);
    expect(max[1]).toBeCloseTo(0);
    expect(min[2]).toBeCloseTo(10);
    expect(max[2]).toBeCloseTo(10 + 0.06 + 2 * TREAD_DEPTH);
  });

  it('has up-facing treads at each step height', () => {
    const mesh = buildStairs(transition, wall, opening, gym, 0)!;
    const heights = new Set<number>();
    for (let i = 0; i < mesh.normals.length; i += 3) {
      if (mesh.normals[i + 1] === 1) heights.add(Math.round(mesh.positions[i + 1]! * 1000) / 1000);
    }
    expect([...heights].sort()).toEqual([-0.17, 0]);
  });

  it('builds nothing when the host room is the higher side', () => {
    expect(
      buildStairs({ ...transition, host_room_id: hall.id }, wall, opening, hall, 0),
    ).toBeNull();
  });
});
