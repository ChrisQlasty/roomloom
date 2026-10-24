import type { GroundFocus } from '../controls/view-controls';
import type { Vec2 } from '../engine/build/geometry-utils';
import {
  MAP_RADIUS_M,
  mapTransform,
  northOnScreen,
  onMap,
  roomAt,
  type MinimapData,
} from './minimap-data';

/** Colours of the dark, GTA-style minimap; the backdrop keeps it readable on any background. */
export const MINIMAP_COLORS = {
  backdrop: 'rgb(16 18 24 / 62%)',
  rim: 'rgb(255 255 255 / 35%)',
  room: '#7c828d',
  lowerRoom: '#5f646d',
  currentRoom: '#4f8fd6',
  wall: '#f4f4f4',
  glass: '#8fd8ff',
  pin: '#ffb43c',
  outline: '#101318',
  arrow: '#ffffff',
  north: '#e5484d',
} as const;

/** Sizes in CSS pixels, so walls and markers stay legible whatever the map scale. */
const MIN_WALL_PX = 1.5;
const GLASS_PX = 1.5;
const PIN_PX = 3.5;
const ARROW_PX = 9;
const NORTH_PX = 8;
const RIM_PX = 2;
/** Floor levels closer than this (metres) count as the same level. */
const LEVEL_EPS = 0.01;

/** How to draw one frame: the focus, the map's diameter in CSS pixels and the pixel ratio. */
export interface MinimapView {
  focus: GroundFocus;
  sizePx: number;
  dpr: number;
}

/** The subset of `CanvasRenderingContext2D` the minimap uses. */
export type MinimapContext = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

/** Add `polygon` to the current path. */
function addPolygon(ctx: MinimapContext, polygon: readonly Vec2[]): void {
  polygon.forEach(([x, z], i) => (i === 0 ? ctx.moveTo(x, z) : ctx.lineTo(x, z)));
  ctx.closePath();
}

function circle(ctx: MinimapContext, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
}

/** The player: an arrow at `center` pointing up, `size` device pixels tall. */
function drawArrow(ctx: MinimapContext, [cx, cy]: Vec2, size: number): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.7, cy + size * 0.7);
  ctx.lineTo(cx, cy + size * 0.3);
  ctx.lineTo(cx - size * 0.7, cy + size * 0.7);
  ctx.closePath();
  ctx.fillStyle = MINIMAP_COLORS.arrow;
  ctx.strokeStyle = MINIMAP_COLORS.outline;
  ctx.fill();
  ctx.stroke();
}

/** The "N" badge on the rim, in the direction of north. */
function drawNorth(
  ctx: MinimapContext,
  center: Vec2,
  radius: number,
  yawDeg: number,
  dpr: number,
): void {
  const r = NORTH_PX * dpr;
  const [nx, ny] = northOnScreen(yawDeg);
  const at = radius - r - RIM_PX * dpr;
  const [x, y] = [center[0] + nx * at, center[1] + ny * at];
  circle(ctx, x, y, r);
  ctx.fillStyle = MINIMAP_COLORS.north;
  ctx.fill();
  ctx.fillStyle = MINIMAP_COLORS.arrow;
  ctx.font = `bold ${Math.round(r * 1.3)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', x, y + r * 0.08);
}

/**
 * Draw the minimap of `data` onto a square canvas of `view.sizePx × view.dpr` device pixels:
 * rooms (the one at the focus highlighted, lower ones darker), walls with gaps at openings (only
 * the pieces reaching into the map), window glass, placed pins, the player arrow and the north
 * marker.
 */
export function drawMinimap(ctx: MinimapContext, data: MinimapData, view: MinimapView): void {
  const { focus, dpr } = view;
  const size = view.sizePx * dpr;
  const radius = size / 2;
  const center: Vec2 = [radius, radius];
  const scale = radius / MAP_RADIUS_M;
  const px = dpr / scale; // one CSS pixel in plan metres

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  circle(ctx, radius, radius, radius);
  ctx.fillStyle = MINIMAP_COLORS.backdrop;
  ctx.fill();

  ctx.setTransform(...mapTransform(focus, scale, center));
  const current = roomAt(data.rooms, [focus.x, focus.z]);
  const level = current?.floorLevel ?? 0;
  for (const room of data.rooms) {
    ctx.beginPath();
    addPolygon(ctx, room.polygon);
    ctx.fillStyle =
      room === current
        ? MINIMAP_COLORS.currentRoom
        : room.floorLevel < level - LEVEL_EPS
          ? MINIMAP_COLORS.lowerRoom
          : MINIMAP_COLORS.room;
    ctx.fill();
  }

  // One path per wall thickness; walls thinner than MIN_WALL_PX get an outline making up the rest.
  const minWall = MIN_WALL_PX * px;
  ctx.fillStyle = ctx.strokeStyle = MINIMAP_COLORS.wall;
  ctx.lineJoin = 'round';
  for (const { thickness, pieces } of data.walls) {
    const shown = pieces.filter((p) => onMap(p.box, focus));
    if (!shown.length) continue;
    ctx.beginPath();
    for (const piece of shown) addPolygon(ctx, piece.polygon);
    ctx.fill();
    if (thickness < minWall) {
      ctx.lineWidth = minWall - thickness;
      ctx.stroke();
    }
  }

  if (data.glass.length) {
    ctx.beginPath();
    for (const { a, b } of data.glass) {
      ctx.moveTo(...a);
      ctx.lineTo(...b);
    }
    ctx.strokeStyle = MINIMAP_COLORS.glass;
    ctx.lineWidth = GLASS_PX * px;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }

  ctx.fillStyle = MINIMAP_COLORS.pin;
  ctx.strokeStyle = MINIMAP_COLORS.outline;
  ctx.lineWidth = px;
  for (const [x, z] of data.pins) {
    circle(ctx, x, z, PIN_PX * px);
    ctx.fill();
    ctx.stroke();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = 1.5 * dpr;
  drawArrow(ctx, center, ARROW_PX * dpr);
  circle(ctx, radius, radius, radius - (RIM_PX * dpr) / 2);
  ctx.strokeStyle = MINIMAP_COLORS.rim;
  ctx.lineWidth = RIM_PX * dpr;
  ctx.stroke();
  drawNorth(ctx, center, radius, focus.yawDeg, dpr);
}
