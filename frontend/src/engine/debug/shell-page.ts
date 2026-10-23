import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fetchScene } from '../../net/api';
import { resolveShellHit, type ShellTag } from '../build/shell';
import { createDebugWorld } from './debug-world';

/** Project the page shows unless `?project=<slug>` names another. */
const DEFAULT_PROJECT = 'example-l-house';

function describeTag(tag: ShellTag | null): string {
  if (!tag) return '–';
  return [tag.kind, tag.id, tag.side, tag.roomId && `room ${tag.roomId}`]
    .filter(Boolean)
    .join(' · ');
}

/** A world point from a URL parameter like `cam=12,1.6,4`, or null if absent or malformed. */
function vectorParam(params: URLSearchParams, name: string): THREE.Vector3 | null {
  const parts = params.get(name)?.split(',').map(Number);
  if (parts?.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return new THREE.Vector3(parts[0], parts[1], parts[2]);
}

/**
 * Developer page (`?debug=shell`): the shell of one project with plain orbit controls, an axes
 * helper (red +X east, green +Y up, blue +Z south), the draw call count and the entity under the cursor.
 * Optional parameters: `project=<slug>`, `cam=x,y,z` and `look=x,y,z` (world metres).
 */
export async function startShellDebugPage(params: URLSearchParams): Promise<void> {
  const info = document.createElement('pre');
  info.className = 'debug-info';
  document.body.appendChild(info);

  const slug = params.get('project') ?? DEFAULT_PROJECT;
  info.textContent = `loading ${slug}…`;
  const scene = await fetchScene(slug).catch((error: unknown) => {
    info.textContent = String(error);
    return null;
  });
  if (!scene) return;

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05);
  const { renderer, world, shell } = createDebugWorld(slug, scene, camera, 0x1b1d22);
  world.add(new THREE.AxesHelper(5));

  const box = new THREE.Box3().setFromObject(shell.root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  camera.far = size * 10;
  camera.updateProjectionMatrix();
  camera.position.copy(
    vectorParam(params, 'cam') ??
      center.clone().add(new THREE.Vector3(0.5, 0.8, 0.9).multiplyScalar(size)),
  );
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(vectorParam(params, 'look') ?? center);
  controls.update();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let hovered: ShellTag | null = null;
  renderer.domElement.addEventListener('pointermove', (event) => {
    pointer.set(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(shell.root, true)[0];
    hovered = hit ? resolveShellHit(hit) : null;
  });

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(world, camera);
    const { calls, triangles } = renderer.info.render;
    info.textContent = `${slug}\ndraw calls: ${calls}  triangles: ${triangles}\nunder cursor: ${describeTag(hovered)}`;
  });
}
