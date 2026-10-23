import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadExampleScene } from '../engine/build/test-scene';
import { KeyboardInput } from './input';
import { poseOf } from './pose';
import { spawnPose } from './spawn';
import { exampleColliders, FRAME } from './test-world';
import { ViewControls, type ControlEvents } from './view-controls';

const scene = loadExampleScene();
const colliders = exampleColliders(scene);
const bounds = new THREE.Box3(
  new THREE.Vector3(-0.15, -0.34, -0.15),
  new THREE.Vector3(30.15, 3.6, 20.15),
);

/** Just enough of a canvas and its document for PointerLook and OrbitControls. */
function fakeCanvas(): HTMLElement {
  const doc = new EventTarget();
  return Object.assign(new EventTarget(), {
    style: {},
    clientHeight: 800,
    ownerDocument: doc,
    getRootNode: () => doc,
    requestPointerLock: async () => {},
  }) as unknown as HTMLElement;
}

function keyDown(target: EventTarget, code: string): void {
  const event = new Event('keydown');
  Object.defineProperty(event, 'code', { value: code });
  target.dispatchEvent(event);
}

function keyUp(target: EventTarget, code: string): void {
  const event = new Event('keyup');
  Object.defineProperty(event, 'code', { value: code });
  target.dispatchEvent(event);
}

describe('ViewControls', () => {
  let keys: EventTarget;
  let camera: THREE.PerspectiveCamera;
  let controls: ViewControls;
  let modes: ControlEvents['mode'][];
  let poses: ControlEvents['pose'][];

  beforeEach(() => {
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), { pointerLockElement: null, exitPointerLock: () => {} }),
    );
    keys = new EventTarget();
    camera = new THREE.PerspectiveCamera(70, 1.6, 0.05, 1000);
    controls = new ViewControls({
      camera,
      element: fakeCanvas(),
      colliders,
      spawn: spawnPose(scene.shell, { position: [6, 0, 2], yaw_deg: 180 }),
      bounds,
      keyboard: new KeyboardInput(keys),
    });
    modes = [];
    poses = [];
    controls.events.on('mode', (m) => modes.push(m));
    controls.events.on('pose', (p) => poses.push(p));
  });

  afterEach(() => {
    controls.dispose();
    vi.unstubAllGlobals();
  });

  /** Run frames for `seconds`; returns the camera position after each. */
  function run(seconds: number): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    for (let t = 0; t < seconds - 1e-9; t += FRAME) {
      controls.update(FRAME);
      positions.push(camera.position.clone());
    }
    return positions;
  }

  it('starts walking at the spawn point at eye height and reports the pose once settled', () => {
    run(0.5);
    expect(controls.mode).toBe('walk');
    const pose = poses.at(-1)!;
    expect(pose.position[0]).toBeCloseTo(6, 6);
    expect(pose.position[1]).toBeCloseTo(1.6, 3);
    expect(pose.position[2]).toBeCloseTo(2, 6);
    expect(pose.yawDeg).toBeCloseTo(180, 6);
    const count = poses.length;
    run(0.5);
    expect(poses.length).toBe(count);
  });

  it('walks with W while held', () => {
    run(0.2);
    keyDown(keys, 'KeyW');
    run(1);
    keyUp(keys, 'KeyW');
    run(0.5);
    expect(poses.at(-1)!.position[2]).toBeGreaterThan(3.5); // yaw 180 faces +Z (south)
  });

  it('toggles fly with F and collision with C (only while flying)', () => {
    keyDown(keys, 'KeyC');
    keyDown(keys, 'KeyF');
    keyDown(keys, 'KeyC');
    keyDown(keys, 'KeyC');
    keyDown(keys, 'KeyF');
    expect(modes).toEqual([
      { mode: 'fly', collision: true },
      { mode: 'fly', collision: false },
      { mode: 'fly', collision: true },
      { mode: 'walk', collision: true },
    ]);
  });

  it('animates into orbit and back to the last walk position in at most 0.5 s, without jumps', () => {
    run(0.3);
    keyDown(keys, 'KeyW');
    run(0.5);
    keyUp(keys, 'KeyW');
    run(0.5);
    const walkPose = poseOf(camera);

    keyDown(keys, 'KeyO');
    expect(controls.mode).toBe('orbit');
    keyDown(keys, 'KeyO'); // ignored while animating
    const into = [camera.position.clone(), ...run(0.5)];
    expect(controls.orbit.controls.enabled).toBe(true);
    const center = bounds.getCenter(new THREE.Vector3());
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.distanceTo(center.clone().sub(camera.position).normalize())).toBeLessThan(1e-3);
    const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;
    expect(camera.position.distanceTo(center)).toBeGreaterThan(radius);

    keyDown(keys, 'KeyO');
    expect(controls.mode).toBe('walk');
    expect(controls.orbit.controls.enabled).toBe(false);
    const back = [camera.position.clone(), ...run(0.5)];
    const pose = poseOf(camera);
    pose.position.forEach((v, i) => expect(v).toBeCloseTo(walkPose.position[i]!, 3));
    expect(pose.yawDeg).toBeCloseTo(walkPose.yawDeg, 4);
    expect(modes.map((m) => m.mode)).toEqual(['orbit', 'walk']);

    // Eased: no single frame covers more than a tenth of the way.
    for (const path of [into, back]) {
      const total = path[0]!.distanceTo(path.at(-1)!);
      const steps = path.slice(1).map((p, i) => p.distanceTo(path[i]!));
      expect(Math.max(...steps)).toBeLessThan(total / 10);
      expect(steps[0]!).toBeLessThan(total / 100);
    }
  });

  it('returns to flying where the flight was left', () => {
    keyDown(keys, 'KeyF');
    keyDown(keys, 'Space');
    run(0.5);
    keyUp(keys, 'Space');
    run(1);
    const y = camera.position.y;
    keyDown(keys, 'KeyO');
    run(0.5);
    keyDown(keys, 'KeyO');
    run(0.5);
    expect(controls.mode).toBe('fly');
    expect(camera.position.y).toBeCloseTo(y, 6);
  });

  it('ignores F in orbit mode and switches the child view with K', () => {
    keyDown(keys, 'KeyO');
    run(0.5);
    keyDown(keys, 'KeyF');
    expect(controls.mode).toBe('orbit');
    keyDown(keys, 'KeyO');
    run(0.5);
    keyDown(keys, 'KeyK');
    run(0.5);
    expect(camera.position.y).toBeCloseTo(1.25, 3);
  });
});
