import * as THREE from 'three';
import { Colliders } from '../../controls/collision';
import { spawnPose } from '../../controls/spawn';
import { ViewControls, type ControlEvents } from '../../controls/view-controls';
import { assetUrl, fetchProject, fetchScene } from '../../net/api';
import { toBufferGeometry } from '../build/geometry-utils';
import { groundSurface } from '../build/ground';
import { MaterialLibrary } from '../build/materials';
import { ShellBuilder } from '../build/shell';

/** Project the page shows unless `?project=<slug>` names another. */
const DEFAULT_PROJECT = 'example-l-house';
const MAX_PIXEL_RATIO = 2;
/** How far the ground reaches past the building, in metres. */
const GROUND_MARGIN = 200;
const HELP =
  'click: look around · WASD move · Shift run · F fly (Space/Ctrl up/down) · C collision (fly) · O orbit · K child view · Esc release';

function describe(
  mode: ControlEvents['mode'],
  pose: ControlEvents['pose'] | null,
  fps: number,
  calls: number,
): string {
  const fly = mode.mode === 'fly' ? ` (collision ${mode.collision ? 'on' : 'off'})` : '';
  const where = pose
    ? `eye ${pose.position.map((v) => v.toFixed(2)).join(', ')}  yaw ${pose.yawDeg.toFixed(0)}°  pitch ${pose.pitchDeg.toFixed(0)}°`
    : '';
  return `${mode.mode}${fly}  ${fps.toFixed(0)} fps  ${calls} draw calls\n${where}\n${HELP}`;
}

/**
 * Developer page (`?debug=walk`): walk, fly and orbit through one project's shell with collision
 * against it and against flat ground around it. Optional parameter: `project=<slug>`.
 */
export async function startWalkDebugPage(params: URLSearchParams): Promise<void> {
  const info = document.createElement('pre');
  info.className = 'debug-info';
  document.body.appendChild(info);

  const slug = params.get('project') ?? DEFAULT_PROJECT;
  info.textContent = `loading ${slug}…`;
  const loaded = await Promise.all([fetchProject(slug), fetchScene(slug)]).catch(
    (error: unknown) => {
      info.textContent = String(error);
      return null;
    },
  );
  if (!loaded) return;
  const [project, scene] = loaded;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  document.body.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  world.background = new THREE.Color(0x9fb4c8);
  // Plain lighting until the renderer task; enough to tell surfaces apart.
  world.add(
    new THREE.HemisphereLight(0xffffff, 0x444455, 1.4),
    new THREE.AmbientLight(0xffffff, 0.8),
  );
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-20, 40, -10);
  world.add(sun);

  const materials = new MaterialLibrary(scene.materials, {
    quality: 'medium',
    textureUrl: (id) => assetUrl(slug, id),
  });
  const shell = new ShellBuilder(materials);
  shell.build(scene.shell);
  const ground = new THREE.Mesh(
    toBufferGeometry(groundSurface(scene.shell.outline, GROUND_MARGIN)),
    new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 1 }),
  );
  ground.name = 'ground';
  world.add(shell.root, ground);
  const bounds = new THREE.Box3().setFromObject(shell.root);

  const colliders = new Colliders();
  colliders.addColliders('shell', shell.root);
  colliders.addColliders('ground', ground);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
  const controls = new ViewControls({
    camera,
    element: renderer.domElement,
    colliders,
    spawn: spawnPose(scene.shell, project.spawn),
    bounds,
    lowestFloor: Math.min(...scene.shell.rooms.map((r) => r.floor_level)),
  });
  let mode: ControlEvents['mode'] = { mode: controls.mode, collision: true };
  let pose: ControlEvents['pose'] | null = null;
  controls.events.on('mode', (m) => (mode = m));
  controls.events.on('pose', (p) => (pose = p));

  const fit = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  window.addEventListener('resize', fit);

  const timer = new THREE.Timer();
  timer.connect(document);
  let fps = 60;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = timer.getDelta();
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    controls.update(dt);
    renderer.render(world, camera);
    info.textContent = describe(mode, pose, fps, renderer.info.render.calls);
  });
}
