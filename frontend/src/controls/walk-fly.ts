import * as THREE from 'three';
import type { Vec3 } from '../engine/build/geometry-utils';
import type { Colliders } from './collision';
import type { KeyboardInput } from './input';
import { applyPose, forwardOf, wrapYaw, type Pose } from './pose';
import { easeInOut } from './transition';

export const CAPSULE_RADIUS = 0.25;
export const CAPSULE_HEIGHT = 1.7;
/** Highest step (or kerb) the walker climbs without stopping, in metres. */
export const STEP_UP = 0.35;
/** How far the walker follows the ground down (stairs) instead of falling. */
export const SNAP_DOWN = 0.35;
export const EYE_HEIGHT = 1.6;
/** Eye height of the child view (K). */
export const CHILD_EYE_HEIGHT = 1.25;
export const PITCH_LIMIT_DEG = 85;

const WALK_SPEED = 2.0;
const RUN_SPEED = 4.5;
const FLY_SPEED = 4;
const FLY_RUN_SPEED = 10;
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

/** Movement keys as numbers: forward/right/up in −1..1, plus run. */
export interface MoveIntent {
  forward: number;
  right: number;
  up: number;
  run: boolean;
}

/** WASD, Space/Ctrl (fly up/down) and Shift (run) from the keyboard state. */
export function moveIntent(keys: KeyboardInput): MoveIntent {
  const axis = (plus: boolean, minus: boolean): number => Number(plus) - Number(minus);
  return {
    forward: axis(keys.isDown('KeyW'), keys.isDown('KeyS')),
    right: axis(keys.isDown('KeyD'), keys.isDown('KeyA')),
    up: axis(keys.isDown('Space'), keys.isDown('ControlLeft', 'ControlRight')),
    run: keys.isDown('ShiftLeft', 'ShiftRight'),
  };
}

/**
 * The walking and flying body: a capsule (radius 0.25 m, 1.7 m tall) moved through the
 * {@link Colliders}. Walking, the capsule floats {@link STEP_UP} above the feet, so steps and
 * kerbs pass under it and a downward ground probe lifts the feet onto them; gravity pulls it down.
 * Flying has no gravity, and collision can be switched off.
 */
export class WalkFly {
  /** Feet position, world metres. */
  readonly feet = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  yawDeg = 0;
  pitchDeg = 0;
  /** Fly mode: no gravity, Space/Ctrl move up and down. */
  fly = false;
  /** Collision while flying; walking always collides. */
  collision = true;
  grounded = false;
  private eyeHeight = EYE_HEIGHT;
  private eyeTween: { from: number; to: number; t: number } | null = null;
  /** Eye offset left by the last step up or down, eased back to zero. */
  private stepLag = 0;
  private readonly segment = new THREE.Line3();
  private readonly move = new THREE.Vector3();

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

  /** Switch flying on or off; walking starts at rest and falls if in the air. */
  setFly(fly: boolean): void {
    this.fly = fly;
    this.velocity.y = 0;
    this.grounded = false;
  }

  /** The eye pose (camera position and direction). */
  pose(): Pose {
    return {
      position: [this.feet.x, this.feet.y + this.eyeHeight + this.stepLag, this.feet.z],
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
    const speed = this.fly
      ? intent.run
        ? FLY_RUN_SPEED
        : FLY_SPEED
      : intent.run
        ? RUN_SPEED
        : WALK_SPEED;
    const [fx, fz] = forwardOf(this.yawDeg);
    let wx = fx * intent.forward - fz * intent.right;
    let wz = fz * intent.forward + fx * intent.right;
    const len = Math.hypot(wx, wz);
    if (len > 1) [wx, wz] = [wx / len, wz / len];
    const k = 1 - Math.exp(-ACCELERATION * dt);
    const v = this.velocity;
    v.x += (wx * speed - v.x) * k;
    v.z += (wz * speed - v.z) * k;
    if (this.fly) v.y += (intent.up * speed - v.y) * k;
    // On the ground, the probe keeps the feet on it; gravity only acts in the air.
    else v.y = this.grounded ? 0 : Math.max(v.y - GRAVITY * dt, -MAX_FALL_SPEED);

    this.move.copy(v).multiplyScalar(dt);
    const steps = Math.max(1, Math.ceil(this.move.length() / MAX_SUBSTEP));
    this.move.divideScalar(steps);
    for (let i = 0; i < steps; i++) this.step(this.move);
    if (this.feet.y < this.lowestFloor - FALL_LIMIT) this.respawn();
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
    const prevY = feet.y;
    feet.add(move);
    if (this.fly && !this.collision) return;

    // Walls and other obstacles: push the floating capsule out (only sideways when walking).
    const bottom = STEP_UP + CAPSULE_RADIUS;
    this.segment.start.set(feet.x, feet.y + bottom, feet.z);
    this.segment.end.set(feet.x, feet.y + CAPSULE_HEIGHT - CAPSULE_RADIUS, feet.z);
    this.colliders.resolveCapsule(this.segment, CAPSULE_RADIUS, !this.fly);
    feet.set(this.segment.start.x, this.segment.start.y - bottom, this.segment.start.z);

    // Ground: from a step's height above the feet down to where they ended (or a bit lower
    // while walking on the ground, to follow stairs down instead of falling).
    const top = Math.max(prevY, feet.y) + STEP_UP;
    const follow = !this.fly && this.grounded;
    const lowest = Math.min(feet.y, follow ? prevY - SNAP_DOWN : feet.y);
    const ground = this.colliders.groundHeight(feet.x, feet.z, top, top - lowest, CAPSULE_RADIUS);
    if (this.fly) {
      if (ground !== null && ground > feet.y) feet.y = ground;
      return;
    }
    if (ground !== null && (follow || ground >= feet.y)) {
      if (follow) this.stepLag = THREE.MathUtils.clamp(this.stepLag - (ground - feet.y), -0.5, 0.5);
      feet.y = ground;
      this.velocity.y = 0;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
  }
}

/**
 * Mouse look with pointer lock: a click on `element` locks the pointer (when enabled), and mouse
 * movement while locked turns the view. Esc releases the lock (browser default).
 */
export class PointerLook {
  enabled = true;
  private readonly onClick = (): void => {
    if (this.enabled && !this.locked) void this.element.requestPointerLock();
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
