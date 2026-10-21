import * as THREE from 'three';
import { fetchHealth } from './net/api';

const HEALTH_POLL_MS = 5000;

function startScene(): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
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

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

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

async function pollHealth(el: HTMLElement): Promise<void> {
  const state = await fetchHealth();
  el.textContent = `backend: ${state}`;
  el.dataset.state = state;
}

startScene();
const healthEl = document.getElementById('health');
if (healthEl) {
  void pollHealth(healthEl);
  setInterval(() => void pollHealth(healthEl), HEALTH_POLL_MS);
}
