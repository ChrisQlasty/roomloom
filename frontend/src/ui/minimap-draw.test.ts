import { describe, expect, it } from 'vitest';
import { roomCenter } from '../controls/spawn';
import { loadExampleScene } from '../engine/build/test-scene';
import { minimapData, onMap } from './minimap-data';
import { drawMinimap, MINIMAP_COLORS, type MinimapContext } from './minimap-draw';

const scene = loadExampleScene();
const data = minimapData(scene.shell, scene.pins);

/** What a fill or stroke painted: its style, the first point and subpaths of its path (map space). */
interface Paint {
  op: 'fill' | 'stroke';
  style: string;
  lineWidth: number;
  first: [number, number] | null;
  moves: number;
  arcs: number;
}

/** A 2D context that records every fill and stroke instead of drawing. */
function recordingContext(): { ctx: MinimapContext; paints: Paint[] } {
  const paints: Paint[] = [];
  let first: [number, number] | null = null;
  let moves = 0;
  let arcs = 0;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    setTransform: () => {},
    clearRect: () => {},
    beginPath: () => {
      first = null;
      moves = 0;
      arcs = 0;
    },
    moveTo: (x: number, y: number) => {
      first ??= [x, y];
      moves++;
    },
    lineTo: () => {},
    closePath: () => {},
    arc: () => arcs++,
    fill: () => paint('fill', String(ctx.fillStyle)),
    stroke: () => paint('stroke', String(ctx.strokeStyle)),
    fillText: () => {},
  };
  const paint = (op: Paint['op'], style: string): number =>
    paints.push({ op, style, lineWidth: ctx.lineWidth, first, moves, arcs });
  return { ctx: ctx as unknown as MinimapContext, paints };
}

function roomFills(roomId: string): string[] {
  const at = roomCenter(scene.shell.rooms.find((r) => r.id === roomId)!.polygon);
  const { ctx, paints } = recordingContext();
  drawMinimap(ctx, data, { focus: { x: at[0], z: at[1], yawDeg: 30 }, sizePx: 200, dpr: 2 });
  const fills = paints.filter((p) => p.op === 'fill' && p.first);
  return scene.shell.rooms.map((room) => {
    const [x, z] = room.polygon[0]!;
    return fills.find((f) => f.first![0] === x && f.first![1] === z)!.style;
  });
}

describe('drawMinimap', () => {
  const ids = scene.shell.rooms.map((r) => r.id);
  const gym = scene.shell.rooms.find((r) => r.floor_level < 0)!.id;
  const hall = scene.shell.rooms.find((r) => r.floor_level === 0)!.id;

  it('highlights the current room and darkens rooms on a lower floor', () => {
    const fills = roomFills(hall);
    ids.forEach((id, i) => {
      const expected =
        id === hall
          ? MINIMAP_COLORS.currentRoom
          : id === gym
            ? MINIMAP_COLORS.lowerRoom
            : MINIMAP_COLORS.room;
      expect(fills[i]).toBe(expected);
    });
  });

  it('does not darken higher rooms when standing in the sunken one', () => {
    const fills = roomFills(gym);
    ids.forEach((id, i) => {
      expect(fills[i]).toBe(id === gym ? MINIMAP_COLORS.currentRoom : MINIMAP_COLORS.room);
    });
  });

  it('fills the walls as one path per thickness, widening thin ones to the minimum', () => {
    const { ctx, paints } = recordingContext();
    const focus = { x: 15, z: 10, yawDeg: 0 };
    drawMinimap(ctx, data, { focus, sizePx: 200, dpr: 1 });
    const fills = paints.filter((p) => p.op === 'fill' && p.style === MINIMAP_COLORS.wall);
    const shown = data.walls.map((g) => g.pieces.filter((p) => onMap(p.box, focus)).length);
    expect(fills.map((f) => f.moves)).toEqual(shown);
    // 200 CSS px span 2 · MAP_RADIUS_M, so the 1.5 px minimum is 0.225 m.
    const strokes = paints.filter((p) => p.op === 'stroke' && p.style === MINIMAP_COLORS.wall);
    const thin = data.walls.filter((g) => g.thickness < 0.225);
    expect(thin.length).toBeGreaterThan(0);
    expect(strokes.map((s) => s.lineWidth)).toEqual(
      thin.map((g) => expect.closeTo(0.225 - g.thickness, 9)),
    );
  });

  it('skips wall pieces off the map', () => {
    const { ctx, paints } = recordingContext();
    drawMinimap(ctx, data, { focus: { x: 200, z: 200, yawDeg: 0 }, sizePx: 200, dpr: 1 });
    expect(paints.some((p) => p.style === MINIMAP_COLORS.wall)).toBe(false);
  });

  it('strokes the glass in one path, and dots every placed pin', () => {
    const { ctx, paints } = recordingContext();
    drawMinimap(ctx, data, { focus: { x: 5, z: 5, yawDeg: 0 }, sizePx: 200, dpr: 1 });
    expect(paints.filter((p) => p.style === MINIMAP_COLORS.glass)).toHaveLength(1);
    const pins = paints.filter((p) => p.op === 'fill' && p.style === MINIMAP_COLORS.pin);
    expect(pins).toHaveLength(data.pins.length);
    expect(pins.every((p) => p.arcs === 1)).toBe(true);
    expect(paints.some((p) => p.style === MINIMAP_COLORS.north)).toBe(true);
  });
});
