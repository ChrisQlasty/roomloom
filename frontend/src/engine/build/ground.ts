import {
  addFace,
  emptyMesh,
  triangulate,
  type MeshData,
  type Vec2,
  type Vec3,
} from './geometry-utils';

/** Height of the flat ground around the building: the entrance level. */
export const GROUND_LEVEL = 0;

/**
 * Flat ground around the building at {@link GROUND_LEVEL}: a square reaching `margin` metres past
 * the footprint `outline`, with the footprint cut out so it never covers a sunken room's floor.
 */
export function groundSurface(outline: readonly Vec2[], margin: number): MeshData {
  const xs = outline.map((p) => p[0]);
  const zs = outline.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs) - margin, Math.max(...xs) + margin];
  const [z0, z1] = [Math.min(...zs) - margin, Math.max(...zs) + margin];
  const square: Vec2[] = [
    [x0, z0],
    [x1, z0],
    [x1, z1],
    [x0, z1],
  ];
  const plan = [...square, ...outline];
  const mesh = emptyMesh();
  const points = plan.map(([x, z]): Vec3 => [x, GROUND_LEVEL, z]);
  addFace(mesh, points, plan, triangulate(square, [outline]), [0, 1, 0]);
  return mesh;
}
