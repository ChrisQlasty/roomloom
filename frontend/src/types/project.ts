/* GENERATED — do not edit. Source: backend/app/schema; run make types. */

/**
 * One project: a building, its profile and how the agent should talk about it.
 */
export interface Project {
  /**
   * Stable project id.
   */
  id: string;
  /**
   * Folder name and URL part.
   */
  slug: string;
  /**
   * Display name.
   */
  name: string;
  /**
   * Short description for the project picker.
   */
  description: string;
  /**
   * Domain flavour for the agent, e.g. 'a 1980s primary school'.
   */
  profile_prompt: string;
  /**
   * ISO 639-1 language code.
   */
  language: string;
  /**
   * Creation time (UTC).
   */
  created_at: string;
  /**
   * Start pose; defaults to the entrance.
   */
  spawn: Spawn | null;
}
/**
 * Where the visitor starts when the project opens.
 */
export interface Spawn {
  /**
   * Feet position in world metres.
   *
   * @minItems 3
   * @maxItems 3
   */
  position: [number, number, number];
  /**
   * View direction, 0 north, clockwise.
   */
  yaw_deg: number;
}
