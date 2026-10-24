import type { GroundFocus } from '../controls/view-controls';
import { drawPixelRatio } from '../engine/pixel-ratio';
import type { Pin, Shell } from '../types/scene';
import { drawMinimap } from './minimap-draw';
import { focusChanged, minimapData, type MinimapData } from './minimap-data';

/** Diameter of the minimap in CSS pixels. */
export const MINIMAP_SIZE_PX = 200;

/**
 * The round minimap in the bottom-right corner: a Canvas2D overlay drawn from scene data (not by
 * rendering 3D). It turns with the heading so the player arrow points up, and redraws only when
 * the focus moves or turns noticeably, the scene changes or the pixel ratio changes.
 */
export class Minimap {
  readonly element: HTMLCanvasElement;
  /** Time the last redraw took, in milliseconds. */
  lastDrawMs = 0;
  private readonly ctx: CanvasRenderingContext2D;
  private data: MinimapData = { rooms: [], walls: [], glass: [], pins: [] };
  private drawn: GroundFocus | null = null;
  private dpr = 0;

  constructor(parent: HTMLElement = document.body) {
    this.element = document.createElement('canvas');
    this.element.className = 'minimap';
    this.element.style.width = this.element.style.height = `${MINIMAP_SIZE_PX}px`;
    const ctx = this.element.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is not available');
    this.ctx = ctx;
    parent.appendChild(this.element);
  }

  /** Show `shell` and the placed ones of `pins`; redraws at the next {@link update}. */
  setScene(shell: Shell, pins: readonly Pin[]): void {
    this.data = minimapData(shell, pins);
    this.drawn = null;
  }

  /** Centre the map on `focus`, redrawing if it changed enough since the last frame drawn. */
  update(focus: GroundFocus): void {
    const dpr = drawPixelRatio();
    if (dpr !== this.dpr) {
      this.dpr = dpr;
      this.element.width = this.element.height = Math.round(MINIMAP_SIZE_PX * dpr);
      this.drawn = null;
    }
    if (!focusChanged(this.drawn, focus)) return;
    const start = performance.now();
    drawMinimap(this.ctx, this.data, { focus, sizePx: MINIMAP_SIZE_PX, dpr });
    this.lastDrawMs = performance.now() - start;
    this.drawn = { ...focus };
  }

  /** Remove the minimap from the page. */
  dispose(): void {
    this.element.remove();
  }
}
