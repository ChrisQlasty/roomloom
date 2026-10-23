import { addQuad, emptyMesh, type MeshData } from './geometry-utils';
import { addFrameBox, frameAxis, framePoint, type Hole, type WallFrame } from './walls';

/** Width of a door or window frame member, seen face on (metres). */
export const FRAME_WIDTH = 0.06;
/** How far a door frame stands proud of each wall face. */
const DOOR_FRAME_PROUD = 0.01;
/** Depth of a window frame across the wall; it sits on the wall's centre plane. */
const WINDOW_FRAME_DEPTH = 0.08;

/** Frame and glass meshes of one opening; passages have neither. */
export interface OpeningFixtures {
  frame: MeshData;
  glass: MeshData;
}

/**
 * Simple fixtures inside a hole: a door gets two jambs and a head lining the hole; a window gets
 * a four-sided frame on the wall's centre plane and a glass pane. Doors have no leaf in v1.
 */
export function buildOpeningFixtures(f: WallFrame, hole: Hole, thickness: number): OpeningFixtures {
  const frame = emptyMesh();
  const glass = emptyMesh();
  const { u0, u1, v0, v1 } = hole;
  const fw = FRAME_WIDTH;
  if (hole.kind === 'door') {
    const half = thickness / 2 + DOOR_FRAME_PROUD;
    addFrameBox(frame, f, [u0, u0 + fw], [v0, v1], [-half, half]);
    addFrameBox(frame, f, [u1 - fw, u1], [v0, v1], [-half, half]);
    addFrameBox(frame, f, [u0 + fw, u1 - fw], [v1 - fw, v1], [-half, half]);
  } else if (hole.kind === 'window') {
    const half = Math.min(WINDOW_FRAME_DEPTH, thickness) / 2;
    addFrameBox(frame, f, [u0, u0 + fw], [v0, v1], [-half, half]);
    addFrameBox(frame, f, [u1 - fw, u1], [v0, v1], [-half, half]);
    addFrameBox(frame, f, [u0 + fw, u1 - fw], [v0, v0 + fw], [-half, half]);
    addFrameBox(frame, f, [u0 + fw, u1 - fw], [v1 - fw, v1], [-half, half]);
    // One pane on the centre plane; the glass material renders both sides.
    const [a, b, c, d] = [
      framePoint(f, u0 + fw, v0 + fw, 0),
      framePoint(f, u1 - fw, v0 + fw, 0),
      framePoint(f, u1 - fw, v1 - fw, 0),
      framePoint(f, u0 + fw, v1 - fw, 0),
    ];
    addQuad(
      glass,
      [a, b, c, d],
      [
        [u0, v0],
        [u1, v0],
        [u1, v1],
        [u0, v1],
      ],
      frameAxis(f, 'w', 1),
    );
  }
  return { frame, glass };
}
