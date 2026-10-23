import type { Project } from '../types/project';
import type { Scene } from '../types/scene';

/** Backend health as shown in the HUD. */
export type HealthState = 'ok' | 'down';

/** How long a health request may take before the backend counts as down. */
export const HEALTH_TIMEOUT_MS = 3000;

/**
 * Ask the backend whether it is alive. Never throws: any failure, including a
 * request that outlives `timeoutMs`, maps to `'down'`.
 */
export async function fetchHealth(
  fetchFn: typeof fetch = fetch,
  timeoutMs: number = HEALTH_TIMEOUT_MS,
): Promise<HealthState> {
  try {
    const response = await fetchFn('/api/health', { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return 'down';
    const body: unknown = await response.json();
    return (body as { status?: unknown }).status === 'ok' ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}

/** URL of a project's asset file. */
export function assetUrl(slug: string, assetId: string): string {
  return `/api/projects/${encodeURIComponent(slug)}/assets/${encodeURIComponent(assetId)}`;
}

/** GET a project resource as JSON; throws with the HTTP status on failure. */
async function fetchProjectJson<T>(slug: string, path: string, fetchFn: typeof fetch): Promise<T> {
  const response = await fetchFn(`/api/projects/${encodeURIComponent(slug)}${path}`);
  if (!response.ok) throw new Error(`Loading ${slug}${path} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Load a project's metadata (name, spawn point, ...); throws with the HTTP status on failure. */
export function fetchProject(slug: string, fetchFn: typeof fetch = fetch): Promise<Project> {
  return fetchProjectJson<Project>(slug, '', fetchFn);
}

/** Load a project's current scene; throws with the HTTP status on failure. */
export function fetchScene(slug: string, fetchFn: typeof fetch = fetch): Promise<Scene> {
  return fetchProjectJson<Scene>(slug, '/scene', fetchFn);
}
