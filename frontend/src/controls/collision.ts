import * as THREE from 'three';
import { MeshBVH, type ExtendedTriangle } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Surfaces whose normal points up at least this much (about 45° slope) count as ground. */
const MIN_GROUND_NORMAL_Y = 0.7;
/** Resolve passes per capsule query; corrections of one pass can push into another surface. */
const RESOLVE_PASSES = 2;
/** Ground samples around the centre, on a ring just inside the capsule radius. */
const GROUND_RING_SAMPLES = 8;
const GROUND_RING_FRACTION = 0.9;

/** Whether a push points more up or down than sideways (more than 45° from horizontal). */
function mostlyVertical(push: THREE.Vector3): boolean {
  return push.y * push.y > push.x * push.x + push.z * push.z;
}

interface ColliderGroup {
  bvh: MeshBVH;
  box: THREE.Box3;
}

/**
 * World-space triangles of every mesh under `objects` (instanced meshes expanded), as one
 * position-only indexed geometry, or null if there are none.
 */
export function colliderGeometry(objects: readonly THREE.Object3D[]): THREE.BufferGeometry | null {
  const pieces: THREE.BufferGeometry[] = [];
  const world = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  for (const root of objects) {
    root.updateWorldMatrix(true, true);
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const source = obj.geometry as THREE.BufferGeometry;
      const position = source.getAttribute('position');
      if (!position) return;
      const count = obj instanceof THREE.InstancedMesh ? obj.count : 1;
      for (let i = 0; i < count; i++) {
        const piece = new THREE.BufferGeometry();
        piece.setAttribute('position', position.clone());
        piece.setIndex(source.index ? source.index.clone() : [...Array(position.count).keys()]);
        world.copy(obj.matrixWorld);
        if (obj instanceof THREE.InstancedMesh) {
          obj.getMatrixAt(i, instance);
          world.multiply(instance);
        }
        pieces.push(piece.applyMatrix4(world));
      }
    });
  }
  if (pieces.length === 0) return null;
  const merged = pieces.length === 1 ? pieces[0]! : mergeGeometries(pieces);
  if (pieces.length > 1) for (const piece of pieces) piece.dispose();
  return merged;
}

/**
 * Static collision geometry in named groups, one BVH (`three-mesh-bvh`) each: the shell is built
 * once, and objects added or removed later only build or drop their own group.
 */
export class Colliders {
  private readonly groups = new Map<string, ColliderGroup>();
  // Scratch objects, reused so per-frame queries do not allocate.
  private readonly queryBox = new THREE.Box3();
  private readonly triPoint = new THREE.Vector3();
  private readonly capsulePoint = new THREE.Vector3();
  private readonly push = new THREE.Vector3();
  private readonly ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));

  /** Add (or replace) the colliders of group `id`: every mesh under `objects`, at their current pose. */
  addColliders(id: string, objects: THREE.Object3D | readonly THREE.Object3D[]): void {
    this.removeColliders(id);
    const geometry = colliderGeometry(objects instanceof THREE.Object3D ? [objects] : objects);
    if (!geometry) return;
    const bvh = new MeshBVH(geometry);
    this.groups.set(id, { bvh, box: bvh.getBoundingBox(new THREE.Box3()) });
  }

  /** Drop the colliders of group `id`, if any. */
  removeColliders(id: string): void {
    this.groups.get(id)?.bvh.geometry.dispose();
    this.groups.delete(id);
  }

  /** Ids of the collider groups. */
  ids(): string[] {
    return [...this.groups.keys()];
  }

  /** Drop every group. */
  dispose(): void {
    for (const id of this.ids()) this.removeColliders(id);
  }

  /**
   * Move the capsule `segment` (its axis) with `radius` sideways out of every collider it overlaps,
   * in place. Floors and steps are left to {@link groundHeight}; overlaps that only a vertical push
   * would resolve are skipped (see {@link overlapsVertically}). Returns whether anything was hit.
   */
  resolveCapsule(segment: THREE.Line3, radius: number): boolean {
    let hit = false;
    for (let pass = 0; pass < RESOLVE_PASSES; pass++) {
      let moved = false;
      this.forEachNear(segment, radius, (tri) => {
        const push = this.pushOut(tri, segment, radius);
        if (!push || mostlyVertical(push) || push.lengthSq() < 1e-12) return false;
        push.y = 0;
        segment.start.add(push);
        segment.end.add(push);
        moved = true;
        return false;
      });
      if (!moved) break;
      hit = true;
    }
    return hit;
  }

  /**
   * Whether the capsule overlaps a surface above or below its axis, which a sideways push cannot
   * resolve: a ceiling or lintel the head reaches, or a slab across the body.
   */
  overlapsVertically(segment: THREE.Line3, radius: number): boolean {
    let found = false;
    this.forEachNear(segment, radius, (tri) => {
      const push = this.pushOut(tri, segment, radius);
      found = push !== null && mostlyVertical(push);
      return found;
    });
    return found;
  }

  /**
   * Height of the highest ground (an upward-facing surface) under a disc of `radius` around
   * (x, z), between `top` and `top - depth`, or null if there is none. The disc is sampled at its
   * centre and on a ring, so the player stands on a step edge like a capsule would.
   */
  groundHeight(x: number, z: number, top: number, depth: number, radius: number): number | null {
    let best: number | null = null;
    const ring = radius * GROUND_RING_FRACTION;
    for (let i = -1; i < GROUND_RING_SAMPLES; i++) {
      const angle = (i / GROUND_RING_SAMPLES) * Math.PI * 2;
      const r = i < 0 ? 0 : ring;
      this.ray.origin.set(x + Math.cos(angle) * r, top, z + Math.sin(angle) * r);
      for (const group of this.groups.values()) {
        const { min, max } = group.box;
        const { x: ox, z: oz } = this.ray.origin;
        if (ox < min.x || ox > max.x || oz < min.z || oz > max.z || top - depth > max.y) continue;
        for (const hit of group.bvh.raycast(this.ray, THREE.DoubleSide, 0, depth)) {
          if ((hit.face?.normal.y ?? 0) < MIN_GROUND_NORMAL_Y) continue;
          if (best === null || hit.point.y > best) best = hit.point.y;
        }
      }
    }
    return best;
  }

  /**
   * Call `visit` with every triangle near the capsule, until it returns true. The query box is
   * taken once, so `visit` may move the segment.
   */
  private forEachNear(
    segment: THREE.Line3,
    radius: number,
    visit: (tri: ExtendedTriangle) => boolean,
  ): void {
    const box = this.queryBox.makeEmpty().expandByPoint(segment.start).expandByPoint(segment.end);
    box.expandByScalar(radius);
    for (const group of this.groups.values()) {
      if (!group.box.intersectsBox(box)) continue;
      const stopped = group.bvh.shapecast({
        intersectsBounds: (bounds) => bounds.intersectsBox(box),
        intersectsTriangle: visit,
      });
      if (stopped) return;
    }
  }

  /**
   * The push that moves `segment` out of `tri` to `radius` (a shared scratch vector), or null if
   * the capsule does not overlap it.
   */
  private pushOut(
    tri: ExtendedTriangle,
    segment: THREE.Line3,
    radius: number,
  ): THREE.Vector3 | null {
    const distance = tri.closestPointToSegment(segment, this.triPoint, this.capsulePoint);
    if (distance >= radius) return null;
    const push = this.push;
    if (distance > 1e-9) push.subVectors(this.capsulePoint, this.triPoint).divideScalar(distance);
    else tri.getNormal(push);
    return push.multiplyScalar(radius - distance);
  }
}
