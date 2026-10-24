import * as THREE from 'three';
import type { Vec3 } from '../engine/build/geometry-utils';
import type { Colliders } from './collision';
import type { KeyboardInput } from './input';
import { applyPose, forwardOf, wrapYaw, type Pose } from './pose';
import { easeInOut } from './transition';

/** Eye height of the default (adult) walker, in metres. */
export const EYE_HEIGHT = 1.75;
export const CAPSULE_RADIUS = 0.25;
/** The head reaches about 11 cm above the eyes, so the eye never touches a ceiling. */
export const CAPSULE_HEIGHT = EYE_HEIGHT + 0.11;
/** Highest step (or kerb) the walker climbs without stopping, in metres. */
export const STEP_UP = 0.35;
/** How far the walker follows the ground down (stairs) instead of falling. */
export const SNAP_DOWN = 0.35;
/** Height of the capsule's lower sphere centre above the feet. */
const CAPSULE_BOTTOM = STEP_UP + CAPSULE_RADIUS;
/** Eye height of the child view (K). */
export const CHILD_EYE_HEIGHT = 1.25;
export const PITCH_LIMIT_DEG = 85;

const WALK_SPEED = 4;
const RUN_SPEED = 9;
const GRAVITY = 9.81;
const MAX_FALL_SPEED = 30;
/** How quickly the velocity follows the keys (1/s): about 0.2 s to full speed. */
const ACCELERATION = 12;
/** Longest movement per collision substep; well under the capsule radius, so walls are never skipped. */
const MAX_SUBSTEP = 0.08;
/** Longest frame simulated at once, in seconds (after a stall, the rest is dropped). */
const MAX_FRAME = 0.1;
/** Mouse look, degrees per pixel. */
const LOOK_DEG_PER_PX = 0.12;
const EYE_TWEEN_SECONDS = 0.3;
/** How quickly the eye catches up after a step up or down (1/s). */
const STEP_SMOOTHING = 14;
/** Below this height under the lowest floor, the walker has fallen out of the world. */
const FALL_LIMIT = 30;
/** Head bob while walking: how far the eye dips at each step, in metres, at walking speed. */
export const HEAD_BOB_DEPTH = 0.04;
/** Steps per second at walking speed; faster movement steps more often (by the square root). */
const HEAD_BOB_STEPS_PER_SECOND = 2.2;
/** How quickly the bob fades in and out when starting and stopping (1/s). */
const HEAD_BOB_FADE = 8;

/** Movement keys as numbers: forward/right in −1..1, plus run. */
export interface MoveIntent {
  forward: number;
  right: number;
  run: boolean;
}

/** WASD and Shift (run) from the keyboard state. */
export function moveIntent(keys: KeyboardInput): MoveIntent {
  const axis = (plus: boolean, minus: boolean): number => Number(plus) - Number(minus);
  return {
    forward: axis(keys.isDown('KeyW'), keys.isDown('KeyS')),
    right: axis(keys.isDown('KeyD'), keys.isDown('KeyA')),
    run: keys.isDown('ShiftLeft', 'ShiftRight'),
  };
}

/**
 * The walking body: a capsule (radius 0.25 m, 1.86 m tall) moved through the {@link Colliders}.
 * The capsule floats {@link STEP_UP} above the feet, so steps and kerbs pass under it and a
 * downward ground probe lifts the feet onto them; gravity pulls it down. A move that would put
 * the head into a ceiling or lintel is blocked like a wall. On the ground, the eye bobs slightly
 * with each step.
 */
export class Walker {
  /** Feet position, world metres. */
  readonly feet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yawDeg = 0;
  pitchDeg = 0;
  grounded = false;
  private eyeHeight = EYE_HEIGHT;
  private eyeTween: { from: number; to: number; t: number } | null = null;
  /** Eye offset left by the last step up or down, eased back to zero. */
  private stepLag = 0;
  /** Head bob: phase within the current step (radians) and strength (0 standing, 1 walking). */
  private bobPhase = 0;
  private bobWeight = 0;
  private readonly segment = new THREE.Line3();
  private readonly move = new THREE.Vector3();
  private readonly prevFeet = new THREE.Vector3();

  constructor(
    private readonly colliders: Colliders,
    private spawn: { position: Vec3; yawDeg: number },
    private readonly lowestFloor = 0,
  ) {
    this.respawn();
  }

  /** Whether the eye is at the child height (or heading there). */
  get childView(): boolean {
    return (this.eyeTween?.to ?? this.eyeHeight) === CHILD_EYE_HEIGHT;
  }

  /** Stand at `feet` facing `yawDeg`, at rest. */
  placeAt(feet: Vec3, yawDeg: number, pitchDeg = 0): void {
    this.feet.set(feet[0], feet[1], feet[2]);
    this.velocity.set(0, 0, 0);
    this.yawDeg = wrapYaw(yawDeg);
    this.pitchDeg = THREE.MathUtils.clamp(pitchDeg, -PITCH_LIMIT_DEG, PITCH_LIMIT_DEG);
    this.stepLag = 0;
    this.bobPhase = 0;
    this.bobWeight = 0;
    this.grounded = false;
  }

  /** Back to the spawn point. */
  respawn(): void {
    this.placeAt(this.spawn.position, this.spawn.yawDeg);
  }

  /** Turn by a mouse movement in pixels. */
  look(dxPx: number, dyPx: number): void {
    this.yawDeg = wrapYaw(this.yawDeg + dxPx * LOOK_DEG_PER_PX);
    this.pitchDeg = THREE.MathUtils.clamp(
      this.pitchDeg - dyPx * LOOK_DEG_PER_PX,
      -PITCH_LIMIT_DEG,
      PITCH_LIMIT_DEG,
    );
  }

  /** Switch between the adult and the child eye height, with a short tween. */
  toggleChildView(): void {
    const to = this.childView ? EYE_HEIGHT : CHILD_EYE_HEIGHT;
    this.eyeTween = { from: this.eyeHeight, to, t: 0 };
  }

  /** The eye pose (camera position and direction). */
  pose(): Pose {
    return {
      position: [
        this.feet.x,
        this.feet.y + this.eyeHeight + this.stepLag + this.bobOffset(),
        this.feet.z,
      ],
      yawDeg: this.yawDeg,
      pitchDeg: this.pitchDeg,
    };
  }

  /** Put `camera` at the eye. */
  applyTo(camera: THREE.Object3D): void {
    const { position, yawDeg, pitchDeg } = this.pose();
    applyPose(camera, position, yawDeg, pitchDeg);
  }

  /** Simulate `dt` seconds with the given movement keys. */
  update(dt: number, intent: MoveIntent): void {
    dt = Math.min(dt, MAX_FRAME);
    this.updateEye(dt);
    const speed = intent.run ? RUN_SPEED : WALK_SPEED;
    const [fx, fz] = forwardOf(this.yawDeg);
    let wx = fx * intent.forward - fz * intent.right;
    let wz = fz * intent.forward + fx * intent.right;
    const len = Math.hypot(wx, wz);
    if (len > 1) [wx, wz] = [wx / len, wz / len];
    const k = 1 - Math.exp(-ACCELERATION * dt);
    const v = this.velocity;
    v.x += (wx * speed - v.x) * k;
    v.z += (wz * speed - v.z) * k;
    // On the ground, the probe keeps the feet on it; gravity only acts in the air.
    v.y = this.grounded ? 0 : Math.max(v.y - GRAVITY * dt, -MAX_FALL_SPEED);

    this.move.copy(v).multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(this.move.length() / MAX_SUBSTEP));
    this.move.divideScalar(steps);
    const [x0, z0] = [this.feet.x, this.feet.z];
    for (let i = 0; i < steps; i++) this.step(this.move);
    if (this.feet.y < this.lowestFloor - FALL_LIMIT) this.respawn();
    else if (dt > 0) this.updateBob(dt, Math.hypot(this.feet.x - x0, this.feet.z - z0) / dt);
  }

  /** Advance the head bob by the horizontal speed actually moved (not into walls). */
  private updateBob(dt: number, speed: number): void {
    const walking = this.grounded && speed > 0.1;
    const weight = walking ? Math.min(speed / WALK_SPEED, 1.5) : 0;
    this.bobWeight += (weight - this.bobWeight) * (1 - Math.exp(-HEAD_BOB_FADE * dt));
    if (this.bobWeight < 1e-3) {
      this.bobPhase = 0;
      return;
    }
    const rate = HEAD_BOB_STEPS_PER_SECOND * Math.sqrt(speed / WALK_SPEED);
    this.bobPhase = (this.bobPhase + 2 * Math.PI * rate * dt) % (2 * Math.PI);
  }

  /** Eye offset of the head bob: a smooth dip once per step, zero when standing. */
  private bobOffset(): number {
    return (-HEAD_BOB_DEPTH * this.bobWeight * (1 - Math.cos(this.bobPhase))) / 2;
  }

  private updateEye(dt: number): void {
    this.stepLag *= Math.exp(-STEP_SMOOTHING * dt);
    const tween = this.eyeTween;
    if (!tween) return;
    tween.t = Math.min(1, tween.t + dt / EYE_TWEEN_SECONDS);
    this.eyeHeight = THREE.MathUtils.lerp(tween.from, tween.to, easeInOut(tween.t));
    if (tween.t >= 1) this.eyeTween = null;
  }

  /** One collision substep of at most {@link MAX_SUBSTEP}. */
  private step(move: THREE.Vector3): void {
    const feet = this.feet;
    const prev = this.prevFeet.copy(feet);
    const [prevGrounded, prevLag] = [this.grounded, this.stepLag];
    feet.add(move);

    // Walls and other obstacles: push the floating capsule out sideways (floors and steps are
    // handled by the ground probe below).
    this.placeCapsule(feet);
    this.colliders.resolveCapsule(this.segment, CAPSULE_RADIUS);
    feet.set(this.segment.start.x, this.segment.start.y - CAPSULE_BOTTOM, this.segment.start.z);

    // Ground: from a step's height above the feet down to where they ended (or a bit lower
    // while on the ground, to follow stairs down instead of falling).
    const top = Math.max(prev.y, feet.y) + STEP_UP;
    const follow = this.grounded;
    const lowest = Math.min(feet.y, follow ? prev.y - SNAP_DOWN : feet.y);
    const ground = this.colliders.groundHeight(feet.x, feet.z, top, top - lowest, CAPSULE_RADIUS);
    if (ground !== null && (follow || ground >= feet.y)) {
      if (follow) this.stepLag = THREE.MathUtils.clamp(this.stepLag - (ground - feet.y), -0.5, 0.5);
      feet.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }

    // A ceiling or lintel too low for the head (e.g. after stepping up) blocks the move, unless
    // the walker already stood in it, so it can always walk out.
    if (this.headBlocked(feet) && !this.headBlocked(prev)) {
      feet.copy(prev);
      [this.grounded, this.stepLag] = [prevGrounded, prevLag];
    }
  }

  /** Put the capsule segment above `feet`. */
  private placeCapsule(feet: THREE.Vector3): void {
    this.segment.start.set(feet.x, feet.y + CAPSULE_BOTTOM, feet.z);
    this.segment.end.set(feet.x, feet.y + CAPSULE_HEIGHT - CAPSULE_RADIUS, feet.z);
  }

  /** Whether the capsule standing at `feet` overlaps something a sideways push cannot resolve. */
  private headBlocked(feet: THREE.Vector3): boolean {
    this.placeCapsule(feet);
    return this.colliders.overlapsVertically(this.segment, CAPSULE_RADIUS);
  }
}

/**
 * Mouse look with pointer lock: a click on `element` locks the pointer (when enabled), and mouse
 * movement while locked turns the view. Esc releases the lock (browser default).
 */
export class PointerLook {
  enabled = true;
  private readonly onClick = (): void => {
    if (!this.enabled || this.locked) return;
    // The browser refuses a lock right after Esc released one; the next click tries again.
    Promise.resolve(this.element.requestPointerLock()).catch(() => undefined);
  };
  private readonly onMove = (event: MouseEvent): void => {
    if (this.locked) this.onLook(event.movementX, event.movementY);
  };

  constructor(
    private readonly element: HTMLElement,
    private readonly onLook: (dxPx: number, dyPx: number) => void,
  ) {
    element.addEventListener('click', this.onClick);
    document.addEventListener('mousemove', this.onMove);
  }

  /** Whether the pointer is locked to the element. */
  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  /** Release the pointer if locked. */
  release(): void {
    if (this.locked) document.exitPointerLock();
  }

  /** Stop listening and release the pointer. */
  dispose(): void {
    this.release();
    this.element.removeEventListener('click', this.onClick);
    document.removeEventListener('mousemove', this.onMove);
  }
}
