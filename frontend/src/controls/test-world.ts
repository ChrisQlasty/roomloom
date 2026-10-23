import * as THREE from 'three';
import { toBufferGeometry, type Vec2 } from '../engine/build/geometry-utils';
import { groundSurface } from '../engine/build/ground';
import { MaterialLibrary } from '../engine/build/materials';
import { ShellBuilder } from '../engine/build/shell';
import { loadExampleScene } from '../engine/build/test-scene';
import type { Scene } from '../types/scene';
import { Colliders } from './collision';
import { yawOf } from './pose';
import type { MoveIntent, WalkFly } from './walk-fly';

/** Simulation frame length used by the tests: 60 fps. */
export const FRAME = 1 / 60;

/** Colliders of the example project: its shell and the ground around it, as the app builds them. */
export function exampleColliders(scene: Scene = loadExampleScene()): Colliders {
  const shell = new ShellBuilder(new MaterialLibrary(scene.materials, { quality: 'low' }));
  shell.build(scene.shell);
  const ground = new THREE.Mesh(toBufferGeometry(groundSurface(scene.shell.outline, 50)));
  const colliders = new Colliders();
  colliders.addColliders('shell', shell.root);
  colliders.addColliders('ground', ground);
  return colliders;
}

/** Run `seconds` of simulation with fixed keys; returns the feet position after every frame. */
export function hold(
  walker: WalkFly,
  intent: Partial<MoveIntent>,
  seconds: number,
): THREE.Vector3[] {
  const keys: MoveIntent = { forward: 0, right: 0, up: 0, run: false, ...intent };
  const path: THREE.Vector3[] = [];
  for (let t = 0; t < seconds; t += FRAME) {
    walker.update(FRAME, keys);
    path.push(walker.feet.clone());
  }
  return path;
}

/**
 * Walk (or run) towards plan point `to`, turning to face it every frame, until within `reach`
 * metres or `timeout` seconds. Returns the feet positions and the eye heights after every frame.
 */
export function walkTo(
  walker: WalkFly,
  to: Vec2,
  { run = false, reach = 0.1, timeout = 20 } = {},
): { path: THREE.Vector3[]; eyes: number[]; arrived: boolean } {
  const path: THREE.Vector3[] = [];
  const eyes: number[] = [];
  for (let t = 0; t < timeout; t += FRAME) {
    const dx = to[0] - walker.feet.x;
    const dz = to[1] - walker.feet.z;
    if (Math.hypot(dx, dz) < reach) return { path, eyes, arrived: true };
    walker.yawDeg = yawOf(dx, dz);
    walker.update(FRAME, { forward: 1, right: 0, up: 0, run });
    path.push(walker.feet.clone());
    eyes.push(walker.pose().position[1]);
  }
  return { path, eyes, arrived: false };
}
