/** Backend health as shown in the HUD. */
export type HealthState = 'ok' | 'down';

/** Ask the backend whether it is alive. Never throws: any failure maps to `'down'`. */
export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthState> {
  try {
    const response = await fetchFn('/api/health');
    if (!response.ok) return 'down';
    const body: unknown = await response.json();
    return (body as { status?: unknown }).status === 'ok' ? 'ok' : 'down';
  } catch {
    return 'down';
  }
}
