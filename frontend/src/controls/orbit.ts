import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { forwardOf, type Pose } from './pose';
import type { CameraState } from './transition';

/** Closest and farthest orbit distance, as multiples of the building's bounding-sphere radius. */
export const MIN_DISTANCE_FACTOR = 0.6;
export const MAX_DISTANCE_FACTOR = 4;
/** Elevation of the view when orbit mode starts, in degrees. */
const START_ELEVATION_DEG = 30;
/** Keep the camera above the ground: the lowest view is this many degrees above horizontal. */
const MIN_ELEVATION_DEG = 3;
/** How far panning may move the orbit centre past the building, as a multiple of its radius. */
export const PAN_MARGIN_FACTOR = 0.5;

/** Where the orbit camera starts: its position and the point it looks at. */
export interface OrbitView {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

/** Centre and radius of the bounding sphere of `bounds`, with radius at least 1 m. */
function sphereOf(bounds: THREE.Box3): { center: THREE.Vector3; radius: number } {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  return { center: sphere.center, radius: Math.max(sphere.radius, 1) };
}

/**
 * The view orbit mode starts from: looking at the centre of `bounds` from the side of `from` (the
 * current eye), 30° up, far enough for the whole building to fit a camera with a `fovDeg` vertical
 * field of view and `aspect` (width / height), whichever of its two angles is narrower.
 */
export function orbitStartView(
  bounds: THREE.Box3,
  from: Pose,
  fovDeg: number,
  aspect = 1,
): OrbitView {
  const { center, radius } = sphereOf(bounds);
  let dx = from.position[0] - center.x;
  let dz = from.position[2] - center.z;
  if (Math.hypot(dx, dz) < 1) {
    // Standing at the centre: step back, behind the current view direction.
    const [fx, fz] = forwardOf(from.yawDeg);
    [dx, dz] = [-fx, -fz];
  }
  const horizontal = Math.hypot(dx, dz);
  const halfV = THREE.MathUtils.degToRad(fovDeg) / 2;
  const halfH = Math.atan(Math.tan(halfV) * aspect);
  const fit = radius / Math.sin(Math.min(halfV, halfH));
  const distance = THREE.MathUtils.clamp(
    fit,
    radius * MIN_DISTANCE_FACTOR,
    radius * MAX_DISTANCE_FACTOR,
  );
  const elevation = THREE.MathUtils.degToRad(START_ELEVATION_DEG);
  const flat = distance * Math.cos(elevation);
  const position = new THREE.Vector3(
    center.x + (dx / horizontal) * flat,
    center.y + distance * Math.sin(elevation),
    center.z + (dz / horizontal) * flat,
  );
  return { position, target: center };
}

/** The camera state for `view`: at its position, looking at its target. */
export function viewState(view: OrbitView): CameraState {
  // Matrix4.lookAt follows the camera convention (looking down local −Z); Object3D.lookAt does
  // not for non-camera objects.
  const look = new THREE.Matrix4().lookAt(view.position, view.target, THREE.Object3D.DEFAULT_UP);
  return {
    position: view.position.clone(),
    quaternion: new THREE.Quaternion().setFromRotationMatrix(look),
  };
}

/**
 * Orbit mode for the exterior: three's OrbitControls around the centre of the building's bounding
 * box, zoom limited relative to its size, and never below the ground. Panning (drag with the
 * wheel pressed, right-drag, or Shift + drag) slides the orbit centre over the ground, at most
 * {@link PAN_MARGIN_FACTOR} building radii past the building. Re-entering orbit mode starts from
 * the centre again, at rest.
 */
export class OrbitMode {
  readonly controls: OrbitControls;
  private bounds = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  /** Where the orbit centre may be panned to (horizontally). */
  private panArea = this.bounds.clone();
  private readonly shift = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, element: HTMLElement) {
    this.controls = new OrbitControls(camera, element);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    // Pan parallel to the ground, so the orbit centre keeps its height.
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(90 - MIN_ELEVATION_DEG);
    // The scroll wheel zooms; dragging with it pressed pans (instead of zooming).
    this.controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  }

  /** Orbit around `bounds` (the building), with zoom limits from its size. */
  setBounds(bounds: THREE.Box3): void {
    this.bounds = bounds.clone();
    const { center, radius } = sphereOf(bounds);
    this.controls.target.copy(center);
    this.controls.minDistance = radius * MIN_DISTANCE_FACTOR;
    this.controls.maxDistance = radius * MAX_DISTANCE_FACTOR;
    this.panArea = bounds.clone().expandByScalar(radius * PAN_MARGIN_FACTOR);
  }

  /**
   * The view to fly to when entering orbit mode from the eye pose `from`. Centres the orbit on its
   * target right away, so the centre is known during the flight too.
   */
  startView(from: Pose): OrbitView {
    const camera = this.controls.object as THREE.PerspectiveCamera;
    const view = orbitStartView(this.bounds, from, camera.fov, camera.aspect);
    this.controls.target.copy(view.target);
    return view;
  }

  /** Take over the camera, which must already be at a view returned by {@link startView}. */
  enable(): void {
    this.controls.enabled = true;
    this.controls.update();
  }

  /** Release the camera, dropping any momentum left from the last drag. */
  disable(): void {
    const { controls } = this;
    const camera = controls.object;
    const [position, quaternion, target] = [
      camera.position.clone(),
      camera.quaternion.clone(),
      controls.target.clone(),
    ];
    // Without damping, update() applies and clears the pending rotation, pan and zoom; then the
    // camera is put back where it was.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
    camera.position.copy(position);
    camera.quaternion.copy(quaternion);
    controls.target.copy(target);
    controls.enabled = false;
  }

  /** Per frame while enabled: applies damping and keeps the panned centre near the building. */
  update(): void {
    if (!this.controls.enabled) return;
    this.controls.update();
    const { target, object } = this.controls;
    const { min, max } = this.panArea;
    this.shift.set(
      THREE.MathUtils.clamp(target.x, min.x, max.x) - target.x,
      0,
      THREE.MathUtils.clamp(target.z, min.z, max.z) - target.z,
    );
    // Move the camera with the centre, so hitting the limit stops the pan without turning the view.
    target.add(this.shift);
    object.position.add(this.shift);
  }

  /** Stop listening to the canvas. */
  dispose(): void {
    this.controls.dispose();
  }
}
