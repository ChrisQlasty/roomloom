import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { assetUrl, fetchScene } from '../../net/api';
import { MaterialLibrary } from '../build/materials';
import { resolveShellHit, ShellBuilder, type ShellTag } from '../build/shell';

/** Project the page shows unless `?project=<slug>` names another. */
const DEFAULT_PROJECT = 'example-l-house';
const MAX_PIXEL_RATIO = 2;

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

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  document.body.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  world.background = new THREE.Color(0x1b1d22);
  // Plain lighting so ceilings (facing down) stay readable; real lighting comes with the renderer.
  world.add(
    new THREE.HemisphereLight(0xffffff, 0x444455, 1.4),
    new THREE.AmbientLight(0xffffff, 0.8),
  );
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-20, 40, -10);
  world.add(sun, new THREE.AxesHelper(5));

  const materials = new MaterialLibrary(scene.materials, {
    quality: 'medium',
    textureUrl: (id) => assetUrl(slug, id),
  });
  const shell = new ShellBuilder(materials);
  shell.build(scene.shell);
  world.add(shell.root);

  const box = new THREE.Box3().setFromObject(shell.root);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, size * 10);
  camera.position.copy(
    vectorParam(params, 'cam') ??
      center.clone().add(new THREE.Vector3(0.5, 0.8, 0.9).multiplyScalar(size)),
  );
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(vectorParam(params, 'look') ?? center);
  controls.update();

  const fit = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  window.addEventListener('resize', fit);

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
