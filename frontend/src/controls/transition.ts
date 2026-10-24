import * as THREE from 'three';

/** Length of a mode change animation, in seconds (the brief allows at most 0.5 s). */
export const TRANSITION_SECONDS = 0.45;

/** Ease in and out (smootherstep): no velocity jump at either end. */
export function easeInOut(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** A camera position and orientation. */
export interface CameraState {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/** The current state of `camera` (copied). */
export function cameraState(camera: THREE.Object3D): CameraState {
  return { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
}

/**
 * Animates a camera from one state to another: position along a straight line, orientation by
 * spherical interpolation, both eased, so it starts and ends exactly on the given states.
 */
export class CameraTransition {
  private elapsed = 0;

  constructor(
    private readonly from: CameraState,
    private readonly to: CameraState,
    private readonly duration = TRANSITION_SECONDS,
  ) {}

  /** Whether the animation has reached its end state. */
  get done(): boolean {
    return this.elapsed >= this.duration;
  }

  /** Advance by `dt` seconds and pose `camera` accordingly. */
  step(dt: number, camera: THREE.Object3D): void {
    this.elapsed = Math.min(this.duration, this.elapsed + dt);
    const t = easeInOut(this.duration > 0 ? this.elapsed / this.duration : 1);
    camera.position.lerpVectors(this.from.position, this.to.position, t);
    camera.quaternion.slerpQuaternions(this.from.quaternion, this.to.quaternion, t);
  }
}
