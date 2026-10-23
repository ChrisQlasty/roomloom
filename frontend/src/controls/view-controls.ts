import * as THREE from 'three';
import type { Colliders } from './collision';
import { Emitter } from './events';
import { KeyboardInput } from './input';
import { OrbitMode, viewState } from './orbit';
import { applyPose, poseOf, type Pose } from './pose';
import type { SpawnPose } from './spawn';
import { cameraState, CameraTransition } from './transition';
import { moveIntent, PointerLook, Walker } from './walk';

export type ControlMode = 'walk' | 'orbit';

/** Events of {@link ViewControls}. */
export interface ControlEvents {
  /** The camera moved or turned (eye position, yaw and pitch in schema conventions). */
  pose: Pose;
  /** The mode changed. */
  mode: ControlMode;
}

/** Setup of {@link ViewControls}. */
export interface ViewControlsOptions {
  camera: THREE.PerspectiveCamera;
  /** The canvas: clicks lock the pointer, drags orbit. */
  element: HTMLElement;
  colliders: Colliders;
  spawn: SpawnPose;
  /** The building's bounding box, for orbit mode. */
  bounds: THREE.Box3;
  /** Lowest floor level, to detect falling out of the world. */
  lowestFloor?: number;
  /** Keyboard state; one is created on `window` if omitted. */
  keyboard?: KeyboardInput;
}

/** Positions closer than this (metres) and angles closer than this (degrees) count as unchanged. */
const POSE_EPSILON = 1e-3;

function samePose(a: Pose | null, b: Pose): boolean {
  if (!a) return false;
  const moved = a.position.some((v, i) => Math.abs(v - b.position[i]!) > POSE_EPSILON);
  return (
    !moved &&
    Math.abs(a.yawDeg - b.yawDeg) < POSE_EPSILON &&
    Math.abs(a.pitchDeg - b.pitchDeg) < POSE_EPSILON
  );
}

/**
 * The camera controller: walk and orbit (O) with animated changes between them, plus the child
 * eye height (K). Call {@link update} once per frame.
 */
export class ViewControls {
  readonly events = new Emitter<ControlEvents>();
  readonly walker: Walker;
  readonly orbit: OrbitMode;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly keyboard: KeyboardInput;
  private readonly ownsKeyboard: boolean;
  private readonly pointer: PointerLook;
  private readonly unsubscribeKeys: () => void;
  private current: ControlMode = 'walk';
  private transition: { animation: CameraTransition; onDone: () => void } | null = null;
  private lastPose: Pose | null = null;

  constructor(options: ViewControlsOptions) {
    this.camera = options.camera;
    this.ownsKeyboard = !options.keyboard;
    this.keyboard = options.keyboard ?? new KeyboardInput();
    this.walker = new Walker(options.colliders, options.spawn, options.lowestFloor);
    this.orbit = new OrbitMode(options.camera, options.element);
    this.orbit.setBounds(options.bounds);
    this.pointer = new PointerLook(options.element, (dx, dy) => {
      if (this.current !== 'orbit' && !this.transition) this.walker.look(dx, dy);
    });
    this.unsubscribeKeys = this.keyboard.onPress((code) => this.onKey(code));
    this.walker.applyTo(this.camera);
  }

  /** The current mode (during a transition, the mode being entered). */
  get mode(): ControlMode {
    return this.current;
  }

  /** Orbit around new bounds, e.g. after the roof changed. */
  setBounds(bounds: THREE.Box3): void {
    this.orbit.setBounds(bounds);
  }

  /** Advance by `dt` seconds: move the camera and emit `pose` if it changed. */
  update(dt: number): void {
    if (this.transition) {
      this.transition.animation.step(dt, this.camera);
      if (this.transition.animation.done) {
        const { onDone } = this.transition;
        this.transition = null;
        onDone();
      }
    } else if (this.current === 'orbit') {
      this.orbit.update();
    } else {
      this.walker.update(dt, moveIntent(this.keyboard));
      this.walker.applyTo(this.camera);
    }
    const pose = poseOf(this.camera);
    if (!samePose(this.lastPose, pose)) {
      this.lastPose = pose;
      this.events.emit('pose', pose);
    }
  }

  /** Handle a mode key (O, K); other keys are ignored. */
  onKey(code: string): void {
    if (this.transition) return;
    switch (code) {
      case 'KeyO':
        if (this.current === 'orbit') this.leaveOrbit();
        else this.enterOrbit();
        return;
      case 'KeyK':
        this.walker.toggleChildView();
        return;
    }
  }

  /** Stop listening to input. */
  dispose(): void {
    this.unsubscribeKeys();
    if (this.ownsKeyboard) this.keyboard.dispose();
    this.pointer.dispose();
    this.orbit.dispose();
  }

  private enterOrbit(): void {
    this.pointer.release();
    this.pointer.enabled = false;
    const view = this.orbit.startView(this.walker.pose());
    this.animateTo(viewState(view), () => this.orbit.enable());
    this.setMode('orbit');
  }

  /** Back to walking where the walker was (it does not move while orbiting). */
  private leaveOrbit(): void {
    this.orbit.disable();
    const target = new THREE.Object3D();
    const { position, yawDeg, pitchDeg } = this.walker.pose();
    applyPose(target, position, yawDeg, pitchDeg);
    this.animateTo(cameraState(target), () => {
      this.pointer.enabled = true;
    });
    this.setMode('walk');
  }

  private animateTo(to: ReturnType<typeof cameraState>, onDone: () => void): void {
    this.transition = { animation: new CameraTransition(cameraState(this.camera), to), onDone };
  }

  private setMode(mode: ControlMode): void {
    this.current = mode;
    this.events.emit('mode', mode);
  }
}
