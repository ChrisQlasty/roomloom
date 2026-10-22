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
