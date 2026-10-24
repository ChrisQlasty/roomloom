import * as THREE from 'three';
import { startShellDebugPage } from './engine/debug/shell-page';
import { startWalkDebugPage } from './engine/debug/walk-page';
import { fetchHealth } from './net/api';

const HEALTH_POLL_MS = 5000;
/** Higher ratios cost fill rate with little visible gain (performance budget, AGENTS.md rule 9). */
const MAX_PIXEL_RATIO = 2;

/** Call `onChange` whenever devicePixelRatio changes, e.g. when the window moves to another monitor. */
function watchPixelRatio(onChange: () => void): void {
  const query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  query.addEventListener(
    'change',
    () => {
      onChange();
      watchPixelRatio(onChange);
    },
    { once: true },
  );
}

function startScene(): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1d22);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.set(2, 1.6, 3);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(3, 5, 2);
  scene.add(sun);

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xc8a27a, roughness: 0.6 }),
  );
  scene.add(box);

  const fitToWindow = (): void => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  fitToWindow();
  window.addEventListener('resize', fitToWindow);
  watchPixelRatio(fitToWindow);

  const timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop((time) => {
    timer.update(time);
    const dt = timer.getDelta();
    box.rotation.x += dt * 0.4;
    box.rotation.y += dt * 0.7;
    renderer.render(scene, camera);
  });
}

/** Update the badge, then schedule the next poll, so requests never overlap. */
async function pollHealth(el: HTMLElement): Promise<void> {
  const state = await fetchHealth();
  el.textContent = `backend: ${state}`;
  el.dataset.state = state;
  setTimeout(() => void pollHealth(el), HEALTH_POLL_MS);
}

const params = new URLSearchParams(window.location.search);
const debugPage = params.get('debug');
if (debugPage === 'shell') void startShellDebugPage(params);
else if (debugPage === 'walk') void startWalkDebugPage(params);
else startScene();
const healthEl = document.getElementById('health');
if (healthEl) void pollHealth(healthEl);
