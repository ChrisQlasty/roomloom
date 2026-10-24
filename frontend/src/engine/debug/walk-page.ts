import * as THREE from 'three';
import { Colliders } from '../../controls/collision';
import { spawnPose } from '../../controls/spawn';
import { ViewControls, type ControlEvents } from '../../controls/view-controls';
import { fetchProject, fetchScene } from '../../net/api';
import { Minimap } from '../../ui/minimap';
import { toBufferGeometry } from '../build/geometry-utils';
import { groundSurface } from '../build/ground';
import { createDebugWorld } from './debug-world';

/** Project the page shows unless `?project=<slug>` names another. */
const DEFAULT_PROJECT = 'example-l-house';
/** How far the ground reaches past the building, in metres. */
const GROUND_MARGIN = 200;
const HELP = [
  'click: look around · WASD move · Shift run · K child view · Esc release',
  'O orbit (drag turn, wheel-drag/right-drag/Shift-drag pan, scroll zoom)',
].join('\n');

function describe(
  mode: ControlEvents['mode'],
  pose: ControlEvents['pose'] | null,
  fps: number,
  calls: number,
  minimapMs: number,
): string {
  const where = pose
    ? `eye ${pose.position.map((v) => v.toFixed(2)).join(', ')}  yaw ${pose.yawDeg.toFixed(0)}°  pitch ${pose.pitchDeg.toFixed(0)}°`
    : '';
  const stats = `${fps.toFixed(0)} fps  ${calls} draw calls  minimap ${minimapMs.toFixed(2)} ms`;
  return `${mode}  ${stats}\n${where}\n${HELP}`;
}

/**
 * Developer page (`?debug=walk`): walk and orbit through one project's shell with collision
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

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
  const { renderer, world, shell } = createDebugWorld(slug, scene, camera, 0x9fb4c8);
  const ground = new THREE.Mesh(
    toBufferGeometry(groundSurface(scene.shell.outline, GROUND_MARGIN)),
    new THREE.MeshStandardMaterial({ color: 0x7d8a6a, roughness: 1 }),
  );
  ground.name = 'ground';
  world.add(ground);
  const bounds = new THREE.Box3().setFromObject(shell.root);

  const colliders = new Colliders();
  colliders.addColliders('shell', shell.root);
  colliders.addColliders('ground', ground);

  const controls = new ViewControls({
    camera,
    element: renderer.domElement,
    colliders,
    spawn: spawnPose(scene.shell, project.spawn),
    bounds,
    lowestFloor: Math.min(...scene.shell.rooms.map((r) => r.floor_level)),
  });
  let mode = controls.mode;
  let pose: ControlEvents['pose'] | null = null;
  controls.events.on('mode', (m) => (mode = m));
  controls.events.on('pose', (p) => (pose = p));
  const minimap = new Minimap();
  minimap.setScene(scene.shell, scene.pins);

  const timer = new THREE.Timer();
  timer.connect(document);
  let fps = 60;
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = timer.getDelta();
    if (dt > 0) fps += (1 / dt - fps) * 0.05;
    controls.update(dt);
    minimap.update(controls.focus());
    renderer.render(world, camera);
    info.textContent = describe(mode, pose, fps, renderer.info.render.calls, minimap.lastDrawMs);
  });
}
