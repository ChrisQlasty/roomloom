import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { colliderGeometry, Colliders } from './collision';

/** A 1 m cube centred at `at`. */
function cube(at: [number, number, number]): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  mesh.position.set(...at);
  return mesh;
}

/** A vertical capsule axis from y0 to y1 at plan point (x, z). */
function capsuleAt(x: number, z: number, y0 = 0.5, y1 = 1.5): THREE.Line3 {
  return new THREE.Line3(new THREE.Vector3(x, y0, z), new THREE.Vector3(x, y1, z));
}

describe('colliderGeometry', () => {
  it('bakes world transforms of nested meshes into one geometry', () => {
    const group = new THREE.Group();
    group.position.set(10, 0, 0);
    group.add(cube([0, 0.5, 0]), cube([0, 0.5, 5]));
    const geometry = colliderGeometry([group])!;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.min.toArray()).toEqual([9.5, 0, -0.5]);
    expect(geometry.boundingBox!.max.toArray()).toEqual([10.5, 1, 5.5]);
    expect(Object.keys(geometry.attributes)).toEqual(['position']);
    expect(geometry.index!.count).toBe(2 * 36);
  });

  it('expands every instance of an instanced mesh', () => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), undefined, 3);
    for (let i = 0; i < 3; i++)
      mesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 4, 0, 0));
    const geometry = colliderGeometry([mesh])!;
    geometry.computeBoundingBox();
    expect(geometry.boundingBox!.max.x).toBeCloseTo(8.5, 6);
    expect(geometry.index!.count).toBe(3 * 36);
  });

  it('is null without meshes', () => {
    expect(colliderGeometry([new THREE.Group()])).toBeNull();
  });
});

describe('Colliders', () => {
  it('adds, replaces and removes groups', () => {
    const colliders = new Colliders();
    colliders.addColliders('a', cube([0, 0.5, 0]));
    colliders.addColliders('b', [cube([5, 0.5, 0])]);
    colliders.addColliders('a', cube([0, 0.5, 10]));
    expect(colliders.ids()).toEqual(['b', 'a']);
    expect(colliders.groundHeight(0, 0, 2, 3, 0.1)).toBeNull();
    expect(colliders.groundHeight(0, 10, 2, 3, 0.1)).toBeCloseTo(1, 6);
    colliders.removeColliders('a');
    expect(colliders.ids()).toEqual(['b']);
    colliders.dispose();
    expect(colliders.ids()).toEqual([]);
  });

  it('pushes an overlapping capsule out to its radius', () => {
    const colliders = new Colliders();
    colliders.addColliders('wall', cube([0, 1, 0]));
    const segment = capsuleAt(0.6, 0);
    expect(colliders.resolveCapsule(segment, 0.25)).toBe(true);
    expect(segment.start.x).toBeCloseTo(0.75, 6);
    expect(segment.start.y).toBeCloseTo(0.5, 6);
    expect(colliders.resolveCapsule(capsuleAt(2, 0), 0.25)).toBe(false);
  });

  it('pushes only sideways', () => {
    const colliders = new Colliders();
    colliders.addColliders('ledge', cube([0, 0, 0]));
    // The capsule's lower sphere sits on the ledge's top edge (at y 0.5, x 0.5).
    const segment = capsuleAt(0.6, 0, 0.6, 1.5);
    colliders.resolveCapsule(segment, 0.25);
    expect(segment.start.y).toBe(0.6);
    expect(segment.start.x).toBeGreaterThan(0.6);
    expect(colliders.overlapsVertically(segment, 0.25)).toBe(false);
  });

  it('reports a ceiling the head reaches instead of pushing the capsule down', () => {
    const colliders = new Colliders();
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(Math.PI / 2));
    ceiling.position.y = 2;
    colliders.addColliders('ceiling', ceiling);
    const segment = capsuleAt(0, 0, 0.6, 1.9);
    expect(colliders.resolveCapsule(segment, 0.25)).toBe(false);
    expect(segment.end.y).toBe(1.9);
    expect(colliders.overlapsVertically(segment, 0.25)).toBe(true);
    expect(colliders.overlapsVertically(capsuleAt(0, 0, 0.6, 1.7), 0.25)).toBe(false);
  });

  it('finds the highest upward-facing ground under a disc', () => {
    const colliders = new Colliders();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2));
    colliders.addColliders('floor', floor);
    colliders.addColliders('step', cube([1, -0.3, 0])); // top at 0.2, from x 0.5
    expect(colliders.groundHeight(0, 0, 0.35, 1, 0.25)).toBeCloseTo(0, 6);
    expect(colliders.groundHeight(0.3, 0, 0.35, 1, 0.25)).toBeCloseTo(0.2, 6);
    // Above the probe's top, or deeper than its depth, nothing counts.
    expect(colliders.groundHeight(1, 0, 0.1, 1, 0.25)).toBeCloseTo(0, 6);
    expect(colliders.groundHeight(-2, 0, 1, 0.5, 0.25)).toBeNull();
  });

  it('does not count downward-facing or steep faces as ground', () => {
    const colliders = new Colliders();
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(Math.PI / 2));
    const slope = new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 6));
    slope.position.set(10, 0, 0);
    colliders.addColliders('c', [ceiling, slope]);
    expect(colliders.groundHeight(0, 0, 1, 2, 0)).toBeNull();
    expect(colliders.groundHeight(10, 0, 3, 6, 0)).toBeNull();
  });
});
