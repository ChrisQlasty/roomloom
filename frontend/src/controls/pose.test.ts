import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyPose, forwardOf, poseOf, wrapYaw, yawOf } from './pose';

describe('yaw conventions', () => {
  it.each([
    [0, 0, -1],
    [90, 1, 0],
    [180, 0, 1],
    [270, -1, 0],
  ])('yaw %d faces (%d, %d)', (yaw, dx, dz) => {
    const [fx, fz] = forwardOf(yaw);
    expect(fx).toBeCloseTo(dx, 9);
    expect(fz).toBeCloseTo(dz, 9);
    expect(yawOf(dx, dz)).toBeCloseTo(yaw, 9);
  });

  it('wraps into [0, 360)', () => {
    expect(wrapYaw(-10)).toBe(350);
    expect(wrapYaw(370)).toBe(10);
    expect(wrapYaw(360)).toBe(0);
  });
});

describe('applyPose and poseOf', () => {
  it('round-trip, and the camera looks along yaw and pitch', () => {
    const camera = new THREE.PerspectiveCamera();
    applyPose(camera, [1, 2, 3], 120, -20);
    const pose = poseOf(camera);
    expect(pose.position).toEqual([1, 2, 3]);
    expect(pose.yawDeg).toBeCloseTo(120, 6);
    expect(pose.pitchDeg).toBeCloseTo(-20, 6);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const [fx, fz] = forwardOf(120);
    expect(dir.x / Math.cos(THREE.MathUtils.degToRad(20))).toBeCloseTo(fx, 6);
    expect(dir.z / Math.cos(THREE.MathUtils.degToRad(20))).toBeCloseTo(fz, 6);
  });

  it('takes the yaw from the screen up when looking straight down', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 10, 0);
    camera.up.set(1, 0, 0); // screen up is east
    camera.lookAt(0, 0, 0);
    const pose = poseOf(camera);
    expect(pose.pitchDeg).toBeCloseTo(-90, 6);
    expect(pose.yawDeg).toBeCloseTo(90, 6);
  });
});
