import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** A plan point [x, y] in metres (world x, z). */
export type Vec2 = readonly [number, number];
/** A world point [x, y, z] in metres. */
export type Vec3 = readonly [number, number, number];

/** Plain triangle mesh arrays; cheap to build and test without a GPU, converted to BufferGeometry last. */
export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

/** Tolerance for comparing lengths and heights, in metres. */
export const EPS = 1e-6;

/** A mesh with no vertices. */
export function emptyMesh(): MeshData {
  return { positions: [], normals: [], uvs: [], indices: [] };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Append a flat face: `points` with their `uvs`, joined by `triangles` (indices into `points`).
 * Each triangle is wound so that its front side faces `normal`, whatever order it came in.
 */
export function addFace(
  mesh: MeshData,
  points: readonly Vec3[],
  uvs: readonly Vec2[],
  triangles: readonly number[],
  normal: Vec3,
): void {
  const base = mesh.positions.length / 3;
  points.forEach((p, i) => {
    const uv = uvs[i] ?? [0, 0];
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.normals.push(normal[0], normal[1], normal[2]);
    mesh.uvs.push(uv[0], uv[1]);
  });
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!];
    const winding = dot(cross(sub(points[b]!, points[a]!), sub(points[c]!, points[a]!)), normal);
    if (winding >= 0) mesh.indices.push(base + a, base + b, base + c);
    else mesh.indices.push(base + a, base + c, base + b);
  }
}

/** Append a quad p0-p1-p2-p3 (in order around its edge) facing `normal`. */
export function addQuad(
  mesh: MeshData,
  points: readonly Vec3[],
  uvs: readonly Vec2[],
  normal: Vec3,
): void {
  addFace(mesh, points, uvs, [0, 1, 2, 0, 2, 3], normal);
}

function toVectors(ring: readonly Vec2[]): Vector2[] {
  return ring.map(([x, y]) => new Vector2(x, y));
}

/**
 * Triangulate a simple polygon with optional holes (none may repeat its first point at the end).
 * Returns flat indices into `[...contour, ...holes.flat()]`.
 */
export function triangulate(
  contour: readonly Vec2[],
  holes: readonly (readonly Vec2[])[] = [],
): number[] {
  return ShapeUtils.triangulateShape(toVectors(contour), holes.map(toVectors)).flat();
}

/** Area of a simple polygon in square metres, whatever its winding. */
export function polygonArea(polygon: readonly Vec2[]): number {
  return Math.abs(ShapeUtils.area(toVectors(polygon)));
}

/**
 * A horizontal surface over a plan polygon at height `y`, facing up (floors) or down (ceilings).
 * UVs are plan metres (u = x, v = z); materials scale them by their tile size.
 */
export function polygonSurface(
  polygon: readonly Vec2[],
  y: number,
  facing: 'up' | 'down',
): MeshData {
  const mesh = emptyMesh();
  const points = polygon.map(([x, z]): Vec3 => [x, y, z]);
  addFace(mesh, points, polygon, triangulate(polygon), [0, facing === 'up' ? 1 : -1, 0]);
  return mesh;
}

/**
 * `polygon` with every point of `points` that lies inside one of its edges inserted there, in
 * order. Neighbouring surfaces then share vertices along common edges, which avoids T-junction
 * cracks (pixel-wide gaps) where they meet.
 */
export function insertPointsOnEdges(polygon: readonly Vec2[], points: readonly Vec2[]): Vec2[] {
  const result: Vec2[] = [];
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len2 = dx * dx + dz * dz;
    const inside = points
      .map((p) => ({ p, t: ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / len2 }))
      .filter(({ p, t }) => {
        const off = Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / Math.sqrt(len2);
        return off < 1e-4 && t * Math.sqrt(len2) > 1e-4 && (1 - t) * Math.sqrt(len2) > 1e-4;
      })
      .sort((p, q) => p.t - q.t);
    result.push(a);
    for (const { p } of inside) {
      const last = result[result.length - 1]!;
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-4) result.push(p);
    }
  });
  return result;
}

/**
 * Merge tagged meshes into one geometry with a group per non-empty part; a group's
 * `materialIndex` indexes `tags`. Null when every part is empty.
 */
export function mergeTagged<T>(
  parts: readonly { data: MeshData; tag: T }[],
): { geometry: BufferGeometry; tags: T[] } | null {
  const kept = parts.filter((p) => p.data.indices.length > 0);
  if (kept.length === 0) return null;
  const geometry = mergeGeometries(
    kept.map((p) => toBufferGeometry(p.data)),
    true,
  );
  return { geometry, tags: kept.map((p) => p.tag) };
}

/** The tag of triangle `faceIndex` in a geometry from {@link mergeTagged}, or null if out of range. */
export function findFaceTag<T>(
  geometry: BufferGeometry,
  tags: readonly T[],
  faceIndex: number,
): T | null {
  const index = faceIndex * 3;
  const group = geometry.groups.find((g) => index >= g.start && index < g.start + g.count);
  return group?.materialIndex === undefined ? null : (tags[group.materialIndex] ?? null);
}

/** Parts of `[lo, hi]` not covered by any of `covers`, in ascending order. */
export function uncoveredIntervals(
  lo: number,
  hi: number,
  covers: readonly (readonly [number, number])[],
): [number, number][] {
  const sorted = [...covers].sort((p, q) => p[0] - q[0]);
  const gaps: [number, number][] = [];
  let cursor = lo;
  for (const [from, to] of sorted) {
    if (from > cursor + EPS) gaps.push([cursor, Math.min(from, hi)]);
    cursor = Math.max(cursor, to);
    if (cursor >= hi - EPS) break;
  }
  if (cursor < hi - EPS) gaps.push([cursor, hi]);
  return gaps.filter(([from, to]) => to - from > EPS);
}

/** Upload-ready geometry for `mesh`; three computes its bounds when first needed. */
export function toBufferGeometry(mesh: MeshData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(mesh.indices);
  return geometry;
}
