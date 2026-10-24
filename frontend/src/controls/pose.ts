import * as THREE from 'three';
import type { Vec3 } from '../engine/build/geometry-utils';

/**
 * A camera pose in schema conventions: eye position in world metres, yaw in degrees (0 faces
 * north, −Z, increasing clockwise seen from above) and pitch in degrees (positive looks up).
 */
export interface Pose {
  position: Vec3;
  yawDeg: number;
  pitchDeg: number;
}

const DEG = Math.PI / 180;

/** `deg` wrapped into [0, 360). */
export function wrapYaw(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped === 360 ? 0 : wrapped;
}

/** Yaw of the horizontal direction (dx, dz), in degrees. */
export function yawOf(dx: number, dz: number): number {
  return wrapYaw(Math.atan2(dx, -dz) / DEG);
}

/** Unit horizontal direction [dx, dz] of `yawDeg`. */
export function forwardOf(yawDeg: number): [number, number] {
  return [Math.sin(yawDeg * DEG), -Math.cos(yawDeg * DEG)];
}

/** Point `camera` from `position` along yaw and pitch (degrees, schema conventions). */
export function applyPose(
  camera: THREE.Object3D,
  position: Vec3,
  yawDeg: number,
  pitchDeg: number,
): void {
  camera.position.set(position[0], position[1], position[2]);
  // three's rotation about +Y is counter-clockwise from above, so the clockwise yaw is negated.
  camera.rotation.set(pitchDeg * DEG, -yawDeg * DEG, 0, 'YXZ');
}

const scratchDir = new THREE.Vector3();
const scratchUp = new THREE.Vector3();

/** The pose of `camera` in world space. Looking straight down, yaw follows the screen's up. */
export function poseOf(camera: THREE.Camera): Pose {
  camera.updateMatrixWorld();
  const dir = camera.getWorldDirection(scratchDir);
  let [hx, hz] = [dir.x, dir.z];
  if (Math.hypot(hx, hz) < 1e-6) {
    scratchUp.set(0, 1, 0).transformDirection(camera.matrixWorld);
    [hx, hz] = [scratchUp.x * -Math.sign(dir.y), scratchUp.z * -Math.sign(dir.y)];
  }
  const p = camera.getWorldPosition(scratchUp);
  return {
    position: [p.x, p.y, p.z],
    yawDeg: yawOf(hx, hz),
    pitchDeg: Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) / DEG,
  };
}
