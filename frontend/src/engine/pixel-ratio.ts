/** Higher ratios cost fill rate with little visible gain (performance budget, AGENTS.md rule 9). */
export const MAX_PIXEL_RATIO = 2;

/** The pixel ratio to draw at: the screen's, capped at {@link MAX_PIXEL_RATIO}. */
export function drawPixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
}
