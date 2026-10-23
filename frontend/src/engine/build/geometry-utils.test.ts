import { describe, expect, it } from 'vitest';
import {
  findFaceTag,
  insertPointsOnEdges,
  mergeTagged,
  polygonSurface,
  uncoveredIntervals,
  type MeshData,
  type Vec2,
} from './geometry-utils';

const L_SHAPE: Vec2[] = [
  [0, 0],
  [0, 20],
  [4, 20],
  [4, 10],
  [12, 10],
  [12, 0],
];

function trianglesOf(mesh: MeshData): number[][][] {
  const p = (i: number): number[] => mesh.positions.slice(i * 3, i * 3 + 3);
  const out: number[][][] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    out.push([p(mesh.indices[i]!), p(mesh.indices[i + 1]!), p(mesh.indices[i + 2]!)]);
  }
  return out;
}

/** Signed area of each triangle projected on the plan, positive when it faces up (+Y). */
function upFacingArea([a, b, c]: number[][]): number {
  // y component of (b - a) × (c - a)
  return ((b![2]! - a![2]!) * (c![0]! - a![0]!) - (b![0]! - a![0]!) * (c![2]! - a![2]!)) / 2;
}

describe('polygonSurface', () => {
  it('maps UVs to plan metres', () => {
    const mesh = polygonSurface(L_SHAPE, -0.34, 'up');
    for (let i = 0; i < mesh.positions.length / 3; i++) {
      expect(mesh.uvs[i * 2]).toBe(mesh.positions[i * 3]);
      expect(mesh.uvs[i * 2 + 1]).toBe(mesh.positions[i * 3 + 2]);
      expect(mesh.positions[i * 3 + 1]).toBe(-0.34);
    }
  });

  it('covers the polygon area and faces the requested way', () => {
    const area = 4 * 20 + 8 * 10;
    const floor = trianglesOf(polygonSurface(L_SHAPE, 0, 'up')).map(upFacingArea);
    const ceiling = trianglesOf(polygonSurface(L_SHAPE, 3, 'down')).map(upFacingArea);
    expect(floor.every((a) => a > 0)).toBe(true);
    expect(ceiling.every((a) => a < 0)).toBe(true);
    expect(floor.reduce((s, a) => s + a, 0)).toBeCloseTo(area);
    expect(ceiling.reduce((s, a) => s + a, 0)).toBeCloseTo(-area);
  });

  it('gives up and down normals', () => {
    expect(polygonSurface(L_SHAPE, 0, 'up').normals.slice(0, 3)).toEqual([0, 1, 0]);
    expect(polygonSurface(L_SHAPE, 0, 'down').normals.slice(0, 3)).toEqual([0, -1, 0]);
  });

  it('accepts either winding', () => {
    const reversed = [...L_SHAPE].reverse();
    const areas = trianglesOf(polygonSurface(reversed, 0, 'up')).map(upFacingArea);
    expect(areas.every((a) => a > 0)).toBe(true);
  });
});

describe('mergeTagged / findFaceTag', () => {
  it('merges parts into groups and resolves faces to tags', () => {
    const square: Vec2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const a = polygonSurface(square, 0, 'up');
    const b = polygonSurface(L_SHAPE, 0, 'up');
    const triangles = (m: MeshData): number => m.indices.length / 3;
    const merged = mergeTagged([
      { data: a, tag: 'a' },
      { data: { positions: [], normals: [], uvs: [], indices: [] }, tag: 'empty' },
      { data: b, tag: 'b' },
    ])!;
    const { geometry, tags } = merged;
    const total = triangles(a) + triangles(b);
    expect(geometry.index!.count).toBe(total * 3);
    expect(tags).toEqual(['a', 'b']);
    expect(findFaceTag(geometry, tags, 0)).toBe('a');
    expect(findFaceTag(geometry, tags, triangles(a))).toBe('b');
    expect(findFaceTag(geometry, tags, total - 1)).toBe('b');
    expect(findFaceTag(geometry, tags, total)).toBeNull();
    expect(
      mergeTagged([{ data: { positions: [], normals: [], uvs: [], indices: [] }, tag: 'x' }]),
    ).toBeNull();
  });
});

describe('uncoveredIntervals', () => {
  it('returns the gaps between covers', () => {
    expect(uncoveredIntervals(0, 3, [])).toEqual([[0, 3]]);
    expect(uncoveredIntervals(0, 3, [[0, 3]])).toEqual([]);
    expect(
      uncoveredIntervals(-0.34, 3.26, [
        [0, 2.6],
        [-0.34, 1],
      ]),
    ).toEqual([[2.6, 3.26]]);
    expect(
      uncoveredIntervals(0, 3, [
        [1, 2],
        [-1, 0.5],
      ]),
    ).toEqual([
      [0.5, 1],
      [2, 3],
    ]);
  });
});

describe('insertPointsOnEdges', () => {
  it('adds points lying inside edges, in order, and ignores corners and points off the edges', () => {
    const corridor: Vec2[] = [
      [12, 7],
      [12, 10],
      [30, 10],
      [30, 7],
    ];
    const points: Vec2[] = [
      [21, 7],
      [12, 7],
      [16, 7],
      [20, 8],
      [12, 9],
    ];
    expect(insertPointsOnEdges(corridor, points)).toEqual([
      [12, 7],
      [12, 9],
      [12, 10],
      [30, 10],
      [30, 7],
      [21, 7],
      [16, 7],
    ]);
  });
});
