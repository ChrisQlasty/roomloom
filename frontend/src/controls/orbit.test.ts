import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MAX_DISTANCE_FACTOR, MIN_DISTANCE_FACTOR, orbitStartView, viewState } from './orbit';
import { CameraTransition, easeInOut, TRANSITION_SECONDS } from './transition';

const bounds = new THREE.Box3(new THREE.Vector3(0, -0.34, 0), new THREE.Vector3(30, 3.6, 20));
const center = bounds.getCenter(new THREE.Vector3());
const radius = bounds.getBoundingSphere(new THREE.Sphere()).radius;

describe('orbitStartView', () => {
  it('looks at the centre from the side of the eye, 30° up, with the building in view', () => {
    const view = orbitStartView(bounds, { position: [28, 1.6, 5], yawDeg: 0, pitchDeg: 0 }, 60);
    expect(view.target.toArray()).toEqual(center.toArray());
    const offset = view.position.clone().sub(center);
    const distance = offset.length();
    expect(distance).toBeGreaterThanOrEqual(radius * MIN_DISTANCE_FACTOR);
    expect(distance).toBeLessThanOrEqual(radius * MAX_DISTANCE_FACTOR);
    expect(distance * Math.sin(THREE.MathUtils.degToRad(30))).toBeGreaterThanOrEqual(radius);
    expect(THREE.MathUtils.radToDeg(Math.asin(offset.y / distance))).toBeCloseTo(30, 6);
    const flat = Math.hypot(offset.x, offset.z);
    expect(offset.x / flat).toBeCloseTo(13 / Math.hypot(13, 5), 6);
    expect(offset.z / flat).toBeCloseTo(-5 / Math.hypot(13, 5), 6);
  });

  it('steps further back in a narrow (portrait) view, so the sides still fit', () => {
    const eye = { position: [28, 1.6, 5] as const, yawDeg: 0, pitchDeg: 0 };
    const wide = orbitStartView(bounds, eye, 40, 2).position.distanceTo(center);
    const narrow = orbitStartView(bounds, eye, 40, 0.5).position.distanceTo(center);
    const halfH = Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) * 0.5);
    expect(narrow).toBeGreaterThan(wide);
    expect(narrow).toBeCloseTo(Math.min(radius / Math.sin(halfH), radius * MAX_DISTANCE_FACTOR), 6);
  });

  it('steps back behind the view direction when the eye is at the centre', () => {
    const at = center.toArray();
    const view = orbitStartView(bounds, { position: at, yawDeg: 90, pitchDeg: 0 }, 60);
    expect(view.position.x).toBeLessThan(center.x);
    expect(view.position.z).toBeCloseTo(center.z, 6);
  });

  it('gives a camera state looking at the target', () => {
    const view = orbitStartView(bounds, { position: [0, 1.6, 0], yawDeg: 0, pitchDeg: 0 }, 60);
    const camera = new THREE.PerspectiveCamera();
    const state = viewState(view);
    camera.position.copy(state.position);
    camera.quaternion.copy(state.quaternion);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const expected = view.target.clone().sub(view.position).normalize();
    expect(dir.distanceTo(expected)).toBeLessThan(1e-6);
  });
});

describe('CameraTransition', () => {
  it('starts and ends exactly on its states, within the time limit, without jumps', () => {
    const camera = new THREE.Object3D();
    const from = { position: new THREE.Vector3(0, 1.6, 0), quaternion: new THREE.Quaternion() };
    const to = viewState({ position: new THREE.Vector3(40, 20, 30), target: center });
    const transition = new CameraTransition(from, to);
    expect(TRANSITION_SECONDS).toBeLessThanOrEqual(0.5);
    const positions: THREE.Vector3[] = [from.position.clone()];
    let frames = 0;
    while (!transition.done) {
      transition.step(1 / 60, camera);
      positions.push(camera.position.clone());
      frames++;
    }
    expect(frames).toBeLessThanOrEqual(Math.ceil(0.5 * 60));
    expect(camera.position.toArray()).toEqual(to.position.toArray());
    expect(camera.quaternion.angleTo(to.quaternion)).toBeLessThan(1e-6);
    // Eased: the first and last frames move far less than the middle ones.
    const moves = positions.slice(1).map((p, i) => p.distanceTo(positions[i]!));
    expect(moves[0]!).toBeLessThan(Math.max(...moves) / 10);
    expect(moves.at(-1)!).toBeLessThan(Math.max(...moves) / 10);
  });

  it('eases from 0 to 1', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOut(2)).toBe(1);
  });
});
