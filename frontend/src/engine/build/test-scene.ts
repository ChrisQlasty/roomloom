import exampleScene from '../../../../projects/example-l-house/scene.json';
import type { Scene } from '../../types/scene';

/** A fresh copy of the shared example project scene (AGENTS.md rule 8), for tests. */
export function loadExampleScene(): Scene {
  return structuredClone(exampleScene) as unknown as Scene;
}
