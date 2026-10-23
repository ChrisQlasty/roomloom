import * as THREE from 'three';
import { assetUrl } from '../../net/api';
import type { Scene } from '../../types/scene';
import { MaterialLibrary } from '../build/materials';
import { ShellBuilder } from '../build/shell';

const MAX_PIXEL_RATIO = 2;

/** What the developer pages share: a full-window renderer and a lit world with the shell in it. */
export interface DebugWorld {
  renderer: THREE.WebGLRenderer;
  world: THREE.Scene;
  shell: ShellBuilder;
}

/**
 * A full-window renderer for `camera` (kept fitted to the window) and a world with plain lighting,
 * the given `background` colour and the shell of `scene` (project `slug`, for textures).
 */
export function createDebugWorld(
  slug: string,
  scene: Scene,
  camera: THREE.PerspectiveCamera,
  background: THREE.ColorRepresentation,
): DebugWorld {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  document.body.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  world.background = new THREE.Color(background);
  // Plain lighting so ceilings (facing down) stay readable; real lighting comes with the renderer.
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
  world.add(shell.root);

  const fit = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  fit();
  window.addEventListener('resize', fit);
  return { renderer, world, shell };
}
