/* GENERATED — do not edit. Source: backend/app/schema; run make types. */

/**
 * The whole scene document stored in projects/<slug>/scene.json.
 */
export interface Scene {
  /**
   * Version of this document format.
   */
  schema_version: 1;
  /**
   * Incremented by every change set.
   */
  version: number;
  shell: Shell;
  roof: Roof;
  /**
   * All materials by id.
   */
  materials: {
    [k: string]: Material;
  };
  /**
   * Placed objects.
   */
  objects: SceneObject[];
  /**
   * Photo pins.
   */
  pins: Pin[];
  /**
   * Building-level notes.
   */
  notes: Note[];
  /**
   * All assets by id.
   */
  assets: {
    [k: string]: AssetMeta;
  };
}
/**
 * Locked building shell.
 */
export interface Shell {
  /**
   * Building footprint: the union of all rooms.
   *
   * @minItems 3
   */
  outline: [number, number][];
  /**
   * Ceiling for new rooms.
   */
  default_ceiling_height: number;
  wall_thickness: WallThickness;
  /**
   * Material of every exterior wall face.
   */
  facade_material: string;
  /**
   * All rooms.
   *
   * @minItems 1
   */
  rooms: Room[];
  /**
   * All walls.
   */
  walls: Wall[];
  /**
   * All step flights.
   */
  transitions: Transition[];
}
/**
 * Default wall thicknesses.
 */
export interface WallThickness {
  /**
   * Exterior wall thickness in metres.
   */
  exterior: number;
  /**
   * Interior wall thickness in metres.
   */
  interior: number;
}
/**
 * One room of the shell. Geometry is locked; name, tags, notes, surfaces and ceiling edit.
 */
export interface Room {
  /**
   * Room id, prefix 'r_'.
   */
  id: string;
  /**
   * Display name, e.g. 'Room 3A'.
   */
  name: string;
  /**
   * Free-form tags for selectors.
   *
   * Items: Lowercase free-form tag without '#', e.g. 'corridor' or 'ceiling_mounted'.
   */
  tags: string[];
  /**
   * Floor outline in plan coordinates.
   *
   * @minItems 3
   */
  polygon: [number, number][];
  /**
   * Floor height in metres; 0 is the entrance level.
   */
  floor_level: number;
  /**
   * Ceiling height above this room's floor, in metres. At most 8 m and at least the top of every opening in the room's walls + 0.05 m.
   */
  ceiling_height: number;
  /**
   * Notes, e.g. from Miro stickies.
   */
  notes: string[];
  surfaces: Surfaces;
}
/**
 * Surface materials.
 */
export interface Surfaces {
  /**
   * Floor material.
   */
  floor: string;
  /**
   * Ceiling material.
   */
  ceiling: string;
  /**
   * Material of every wall face looking into this room, unless overridden.
   */
  walls: string;
}
/**
 * A straight wall segment from a to b. 'Left' and 'right' are as seen from above.
 */
export interface Wall {
  /**
   * Wall id, prefix 'w_'.
   */
  id: string;
  /**
   * Start point of the centre line.
   *
   * @minItems 2
   * @maxItems 2
   */
  a: [number, number];
  /**
   * End point of the centre line.
   *
   * @minItems 2
   * @maxItems 2
   */
  b: [number, number];
  /**
   * Wall thickness in metres.
   */
  thickness: number;
  /**
   * Exterior walls have one room, interior walls two.
   */
  kind: 'exterior' | 'interior';
  /**
   * Room on the left of a→b.
   */
  left_room_id: string | null;
  /**
   * Room on the right of a→b.
   */
  right_room_id: string | null;
  /**
   * Holes in this wall.
   */
  openings: Opening[];
  face_overrides: FaceOverrides;
}
/**
 * A door, window or open passage inside a wall.
 */
export interface Opening {
  /**
   * Opening id, prefix 'op_'.
   */
  id: string;
  /**
   * What fills the hole.
   */
  kind: 'door' | 'window' | 'passage';
  /**
   * Distance in metres along the wall from end a to the near edge.
   */
  offset: number;
  /**
   * Width along the wall in metres.
   */
  width: number;
  /**
   * Height of the hole in metres.
   */
  height: number;
  /**
   * Height of the bottom edge in metres, measured from the higher floor of the rooms on either side of the wall (the threshold level).
   */
  sill: number;
}
/**
 * Optional per-face materials.
 */
export interface FaceOverrides {
  /**
   * Face on the left of a→b, seen from above.
   */
  left: string | null;
  /**
   * Face on the right of a→b, seen from above.
   */
  right: string | null;
}
/**
 * Steps at an opening between floors at different levels.
 */
export interface Transition {
  /**
   * Transition id, prefix 'tr_'.
   */
  id: string;
  /**
   * Opening the steps lead through.
   */
  opening_id: string;
  /**
   * Number of steps.
   */
  steps: number;
  /**
   * Total height climbed in metres; equals the floor level difference.
   */
  rise_total: number;
  /**
   * Room the steps are built in.
   */
  host_room_id: string;
}
/**
 * The roof.
 */
export interface Roof {
  /**
   * Roof shape.
   */
  type: 'flat' | 'shed' | 'hip' | 'gable';
  /**
   * Slope in degrees (0-70); ignored for flat roofs.
   */
  pitch_deg: number;
  /**
   * Eaves overhang beyond the walls, in metres.
   */
  overhang: number;
  /**
   * Height of the eaves above the highest ceiling, in metres.
   */
  base_offset: number;
  /**
   * Shed roofs: downhill direction in degrees, 0 north, clockwise.
   */
  slope_direction_deg: number | null;
  /**
   * Gable roofs: indices of outline edges that become gable ends.
   */
  gable_edges: number[] | null;
  /**
   * Roof covering material.
   */
  material: string;
  /**
   * Optional fascia material.
   */
  fascia_material: string | null;
}
/**
 * A surface material; keyed by id in scene.materials.
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^mat_[a-z0-9]+(?:_[a-z0-9]+)*$".
 */
export interface Material {
  /**
   * Display name.
   */
  name: string;
  /**
   * Base colour, lowercase #rrggbb.
   */
  color: string;
  /**
   * Optional tileable texture asset.
   */
  texture_asset: string | null;
  /**
   * Real-world size [u, v] of one texture tile, in metres.
   *
   * @minItems 2
   * @maxItems 2
   */
  tile_size_m: [number, number];
  /**
   * PBR roughness, 0-1.
   */
  roughness: number;
  /**
   * PBR metalness, 0-1.
   */
  metalness: number;
  /**
   * Origin; 'photo' means an AI texture generated from a photo.
   */
  source: 'default' | 'user' | 'agent' | 'photo';
}
/**
 * An object placed in the scene.
 */
export interface SceneObject {
  /**
   * Object id, prefix 'obj_'.
   */
  id: string;
  /**
   * Display name.
   */
  name: string;
  /**
   * Room the object belongs to, if any.
   */
  room_id: string | null;
  /**
   * Free-form tags for selectors.
   *
   * Items: Lowercase free-form tag without '#', e.g. 'corridor' or 'ceiling_mounted'.
   */
  tags: string[];
  /**
   * Primitive shape or prefab reference.
   */
  geometry: Box | Cylinder | Sphere | Cone | Pipe | Extrusion | Panel | PrefabRef;
  transform: Transform;
  /**
   * Material per slot: 'main' for primitives, prefab-defined slots otherwise.
   */
  materials: {
    /**
     * Id of a material in scene.materials.
     */
    [k: string]: string;
  };
  /**
   * Who created it.
   */
  created_by: 'agent' | 'user' | 'import';
}
/**
 * Axis-aligned box standing on its base.
 */
export interface Box {
  type: 'box';
  /**
   * [width x, height y, depth z] in metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  size: [number, number, number];
}
/**
 * Upright cylinder standing on its base.
 */
export interface Cylinder {
  type: 'cylinder';
  /**
   * Radius in metres.
   */
  radius: number;
  /**
   * Height in metres.
   */
  height: number;
}
/**
 * Sphere resting on its lowest point.
 */
export interface Sphere {
  type: 'sphere';
  /**
   * Radius in metres.
   */
  radius: number;
}
/**
 * Upright cone with its base on the ground and apex up.
 */
export interface Cone {
  type: 'cone';
  /**
   * Base radius in metres.
   */
  radius: number;
  /**
   * Height in metres.
   */
  height: number;
}
/**
 * Tube along a polyline of local points.
 */
export interface Pipe {
  type: 'pipe';
  /**
   * Centre-line points in local metres.
   *
   * @minItems 2
   */
  path: [number, number, number][];
  /**
   * Tube radius in metres.
   */
  radius: number;
  /**
   * Round the bends instead of mitring them.
   */
  elbows: boolean;
}
/**
 * A 2D profile in the local x/y plane, extruded along z, centred on z = 0.
 */
export interface Extrusion {
  type: 'extrusion';
  /**
   * Outline in the local x/y plane; y = 0 is the ground.
   *
   * @minItems 3
   */
  profile: [number, number][];
  /**
   * Extrusion length along local z in metres.
   */
  depth: number;
}
/**
 * Thin flat vertical panel, front facing local -Z.
 */
export interface Panel {
  type: 'panel';
  /**
   * Width along local x in metres.
   */
  width: number;
  /**
   * Height along local y in metres.
   */
  height: number;
}
/**
 * Reference to a parametric prefab from the prefab registry.
 */
export interface PrefabRef {
  type: 'prefab';
  /**
   * Prefab name, e.g. 'desk'.
   */
  prefab: string;
  /**
   * Prefab parameters; unset ones use prefab defaults.
   */
  params: {
    [k: string]: number | boolean | string;
  };
}
/**
 * World placement.
 */
export interface Transform {
  /**
   * World position of the local origin, in metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  position: [number, number, number];
  /**
   * Rotation [rx, ry, rz] in degrees; ry is yaw, 0 faces north, clockwise.
   *
   * @minItems 3
   * @maxItems 3
   */
  rotation_deg: [number, number, number];
  /**
   * Scale factors [sx, sy, sz].
   *
   * @minItems 3
   * @maxItems 3
   */
  scale: [number, number, number];
}
/**
 * A photo pinned at the pose it was taken from.
 */
export interface Pin {
  /**
   * Pin id, prefix 'pin_'.
   */
  id: string;
  /**
   * The photo.
   */
  asset_id: string;
  /**
   * Camera position in world metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  position: [number, number, number];
  /**
   * View direction, 0 north, clockwise.
   */
  yaw_deg: number;
  /**
   * Up/down tilt in degrees.
   */
  pitch_deg: number;
  /**
   * Vertical field of view in degrees.
   */
  fov_deg: number;
  /**
   * Caption shown with the photo.
   */
  caption: string;
  /**
   * Who took the photo.
   */
  author: string;
  /**
   * Year the photo was taken, if known.
   */
  year: number | null;
  /**
   * False until the pin is positioned in 3D.
   */
  placed: boolean;
}
/**
 * A building-level note.
 */
export interface Note {
  /**
   * Note id, prefix 'note_'.
   */
  id: string;
  /**
   * Note text.
   */
  text: string;
}
/**
 * A content-addressed file under the project's assets/ folder; keyed by id.
 *
 * This interface was referenced by `undefined`'s JSON-Schema definition
 * via the `patternProperty` "^ast_[a-z0-9]+(?:_[a-z0-9]+)*$".
 */
export interface AssetMeta {
  /**
   * What the file is.
   */
  kind: 'photo' | 'texture' | 'thumbnail';
  /**
   * Path relative to the project folder: assets/<sha256>.<ext>.
   */
  path: string;
  /**
   * SHA-256 of the file contents.
   */
  sha256: string;
  /**
   * Width in pixels.
   */
  w: number;
  /**
   * Height in pixels.
   */
  h: number;
  /**
   * File name as uploaded.
   */
  original_name: string | null;
}
