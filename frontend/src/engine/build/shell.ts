import * as THREE from 'three';
import type { Opening, Room, Shell, Transition, Wall } from '../../types/scene';
import {
  findFaceTag,
  insertPointsOnEdges,
  mergeTagged,
  polygonSurface,
  toBufferGeometry,
  uncoveredIntervals,
  type FaceRange,
  type MeshData,
  type Vec2,
} from './geometry-utils';
import { FRAME_MATERIAL, GLASS_MATERIAL, REVEAL_MATERIAL, type MaterialLibrary } from './materials';
import { buildOpeningFixtures } from './openings';
import { buildStairs } from './stairs';
import {
  buildWallGeometry,
  computeWallJoins,
  wallSpan,
  type WallJoin,
  type WallSpan,
} from './walls';

/** What a raycast hit on the shell resolves to. */
export interface ShellTag {
  kind: 'floor' | 'ceiling' | 'wall_face' | 'opening' | 'stairs';
  /** Room, wall, opening or transition id. */
  id: string;
  /** Room the surface faces, if any (null for the facade, wall tops and openings). */
  roomId: string | null;
  /** Wall side for wall faces, as seen from above walking a→b. */
  side: 'left' | 'right' | null;
}

/** Ceilings live in their own layer, so the interior view can hide them. */
export type ShellLayer = 'main' | 'ceiling';

/** One tagged piece of shell geometry with its material. */
export interface ShellPart {
  material: string;
  layer: ShellLayer;
  data: MeshData;
  tag: ShellTag;
}

/** Derived lookups shared by the part builders. */
interface ShellContext {
  shell: Shell;
  rooms: Map<string, Room>;
  spans: Map<string, WallSpan | null>;
  joins: Map<string, WallJoin>;
  openings: Map<string, { wall: Wall; opening: Opening }>;
}

function shellContext(shell: Shell): ShellContext {
  const rooms = new Map(shell.rooms.map((r) => [r.id, r]));
  return {
    shell,
    rooms,
    spans: new Map(shell.walls.map((w) => [w.id, wallSpan(w, rooms)])),
    joins: computeWallJoins(shell.walls),
    openings: new Map(
      shell.walls.flatMap((wall) =>
        wall.openings.map((o) => [o.id, { wall, opening: o }] as const),
      ),
    ),
  };
}

/**
 * Floor and ceiling of a room. `corners` are all room corners of the shell: those lying on this
 * room's edges become vertices too, so its surfaces meet the neighbours' without cracks.
 */
export function roomParts(room: Room, corners: readonly Vec2[] = []): ShellPart[] {
  const tag = { id: room.id, roomId: room.id, side: null };
  const ceiling = room.floor_level + room.ceiling_height;
  const polygon = insertPointsOnEdges(room.polygon, corners);
  return [
    {
      material: room.surfaces.floor,
      layer: 'main',
      data: polygonSurface(polygon, room.floor_level, 'up'),
      tag: { kind: 'floor', ...tag },
    },
    {
      material: room.surfaces.ceiling,
      layer: 'ceiling',
      data: polygonSurface(polygon, ceiling, 'down'),
      tag: { kind: 'ceiling', ...tag },
    },
  ];
}

/** A face shows its override, else the wall material of the room it faces, else the facade. */
function faceMaterial(
  ctx: ShellContext,
  wall: Wall,
  roomId: string | null,
  side: 'left' | 'right',
): string {
  const room = roomId === null ? undefined : ctx.rooms.get(roomId);
  return wall.face_overrides[side] ?? room?.surfaces.walls ?? ctx.shell.facade_material;
}

function wallParts(wall: Wall, ctx: ShellContext): ShellPart[] {
  const span = ctx.spans.get(wall.id);
  const join = ctx.joins.get(wall.id);
  if (!span || !join) return [];
  // End caps are only needed where no wall meeting this end covers that height.
  const caps = (joiners: string[]): [number, number][] =>
    uncoveredIntervals(
      span.bottom,
      span.top,
      joiners.flatMap((id) => {
        const s = ctx.spans.get(id);
        return s ? [[s.bottom, s.top] as const] : [];
      }),
    );
  const geometry = buildWallGeometry(wall, span, join, caps(join.joinersA), caps(join.joinersB));
  const parts: ShellPart[] = [];
  for (const side of ['left', 'right'] as const) {
    const roomId = side === 'left' ? wall.left_room_id : wall.right_room_id;
    parts.push({
      material: faceMaterial(ctx, wall, roomId, side),
      layer: 'main',
      data: geometry[side],
      tag: { kind: 'wall_face', id: wall.id, roomId, side },
    });
  }
  parts.push({
    material: REVEAL_MATERIAL,
    layer: 'main',
    data: geometry.edges,
    tag: { kind: 'wall_face', id: wall.id, roomId: null, side: null },
  });
  for (const hole of geometry.holes) {
    const tag: ShellTag = { kind: 'opening', id: hole.id, roomId: null, side: null };
    const fixtures = buildOpeningFixtures(geometry.frame, hole, wall.thickness);
    parts.push(
      { material: REVEAL_MATERIAL, layer: 'main', data: geometry.reveals.get(hole.id)!, tag },
      { material: FRAME_MATERIAL, layer: 'main', data: fixtures.frame, tag },
      { material: GLASS_MATERIAL, layer: 'main', data: fixtures.glass, tag },
    );
  }
  return parts;
}

function transitionParts(transition: Transition, ctx: ShellContext): ShellPart[] {
  const at = ctx.openings.get(transition.opening_id);
  const host = ctx.rooms.get(transition.host_room_id);
  const span = at && ctx.spans.get(at.wall.id);
  if (!at || !host || !span) return [];
  const data = buildStairs(transition, at.wall, at.opening, host, span.threshold);
  if (!data) {
    console.warn(`Steps ${transition.id}: host room ${host.id} is not the lower side; not built.`);
    return [];
  }
  return [
    {
      material: host.surfaces.floor,
      layer: 'main',
      data,
      tag: { kind: 'stairs', id: transition.id, roomId: host.id, side: null },
    },
  ];
}

const roomKey = (id: string): string => `room:${id}`;
const wallKey = (id: string): string => `wall:${id}`;
const transitionKey = (id: string): string => `transition:${id}`;

/** Parts of the given entities (all when `keys` is omitted), keyed by entity, in a stable order. */
export function buildShellParts(
  shell: Shell,
  keys?: ReadonlySet<string>,
): Map<string, ShellPart[]> {
  const ctx = shellContext(shell);
  const wanted = (key: string): boolean => !keys || keys.has(key);
  const parts = new Map<string, ShellPart[]>();
  for (const room of shell.rooms)
    if (wanted(roomKey(room.id))) parts.set(roomKey(room.id), roomParts(room));
  for (const wall of shell.walls)
    if (wanted(wallKey(wall.id))) parts.set(wallKey(wall.id), wallParts(wall, ctx));
  for (const tr of shell.transitions) {
    if (wanted(transitionKey(tr.id))) parts.set(transitionKey(tr.id), transitionParts(tr, ctx));
  }
  return parts;
}

/**
 * Entities to rebuild when rooms change (ceiling height or surfaces): the rooms, their walls,
 * the walls meeting those (their end caps depend on the neighbours' heights) and their steps.
 */
export function affectedByRooms(shell: Shell, roomIds: readonly string[]): Set<string> {
  const ids = new Set(roomIds);
  const keys = new Set(roomIds.map(roomKey));
  const joins = computeWallJoins(shell.walls);
  for (const wall of shell.walls) {
    if (!ids.has(wall.left_room_id ?? '') && !ids.has(wall.right_room_id ?? '')) continue;
    keys.add(wallKey(wall.id));
    const join = joins.get(wall.id);
    for (const id of [...(join?.joinersA ?? []), ...(join?.joinersB ?? [])]) keys.add(wallKey(id));
  }
  for (const tr of shell.transitions) if (ids.has(tr.host_room_id)) keys.add(transitionKey(tr.id));
  return keys;
}

/** userData of a merged shell mesh. */
export interface ShellBatchData {
  kind: 'shell_batch';
  layer: ShellLayer;
  material: string;
  faceTags: FaceRange<ShellTag>[];
}

/** The shell entity a raycast hit landed on, or null if the hit is not on the shell. */
export function resolveShellHit(hit: THREE.Intersection): ShellTag | null {
  const data = hit.object.userData as Partial<ShellBatchData>;
  if (data.kind !== 'shell_batch' || !data.faceTags || hit.faceIndex == null) return null;
  return findFaceTag(data.faceTags, hit.faceIndex);
}

/**
 * Builds the locked shell into `root` as static meshes merged per layer and material (few draw
 * calls); each mesh keeps face ranges for {@link resolveShellHit}.
 */
export class ShellBuilder {
  readonly root = new THREE.Group();
  /** Ceilings, separate so the interior view can hide them. */
  readonly ceilings = new THREE.Group();
  private readonly main = new THREE.Group();
  private entities = new Map<string, ShellPart[]>();
  private readonly batches = new Map<string, THREE.Mesh>();

  constructor(private readonly materials: MaterialLibrary) {
    this.root.name = 'shell';
    this.main.name = 'shell-main';
    this.ceilings.name = 'shell-ceilings';
    this.root.add(this.main, this.ceilings);
  }

  /** Build the whole shell, replacing anything built before. */
  build(shell: Shell): void {
    const dirty = new Set(this.batches.keys());
    this.entities = buildShellParts(shell);
    this.rebatch(dirty);
  }

  /** Rebuild after rooms changed (ceiling height or surface materials); `shell` is the updated shell. */
  rebuildRooms(ids: readonly string[], shell: Shell): void {
    const dirty = new Set<string>();
    for (const [key, parts] of buildShellParts(shell, affectedByRooms(shell, ids))) {
      for (const part of [...(this.entities.get(key) ?? []), ...parts]) dirty.add(batchKey(part));
      this.entities.set(key, parts);
    }
    this.rebatch(dirty);
  }

  /** Free all geometry (materials belong to the library). */
  dispose(): void {
    for (const mesh of this.batches.values()) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.batches.clear();
    this.entities.clear();
  }

  /** Re-merge the given batches, plus any that do not exist yet. */
  private rebatch(dirty: Set<string>): void {
    const groups = new Map<string, ShellPart[]>();
    for (const parts of this.entities.values()) {
      for (const part of parts) {
        const key = batchKey(part);
        if (!this.batches.has(key)) dirty.add(key);
        const group = groups.get(key);
        if (group) group.push(part);
        else groups.set(key, [part]);
      }
    }
    for (const key of dirty) {
      const parts = groups.get(key) ?? [];
      const old = this.batches.get(key);
      old?.geometry.dispose();
      const { data, ranges } = mergeTagged(parts);
      if (ranges.length === 0) {
        old?.removeFromParent();
        this.batches.delete(key);
        continue;
      }
      const first = parts[0]!;
      const mesh = old ?? new THREE.Mesh();
      mesh.geometry = toBufferGeometry(data);
      mesh.material = this.materials.get(first.material);
      mesh.name = key;
      const userData: ShellBatchData = {
        kind: 'shell_batch',
        layer: first.layer,
        material: first.material,
        faceTags: ranges,
      };
      mesh.userData = userData;
      if (!old) {
        (first.layer === 'ceiling' ? this.ceilings : this.main).add(mesh);
        this.batches.set(key, mesh);
      }
    }
  }
}

function batchKey(part: ShellPart): string {
  return `${part.layer}|${part.material}`;
}
