import * as THREE from 'three';
import type { Material } from '../../types/scene';

/** Render quality preset (selected in T08; the shell only needs it for glass). */
export type QualityPreset = 'low' | 'medium' | 'high';

/** Built-in materials that are not part of the scene document; `__` cannot clash with `mat_` ids. */
export const REVEAL_MATERIAL = '__reveal';
export const FRAME_MATERIAL = '__frame';
export const GLASS_MATERIAL = '__glass';
const BUILT_IN = new Set([REVEAL_MATERIAL, FRAME_MATERIAL, GLASS_MATERIAL]);

const REVEAL_COLOR = 0xd9d4c8;
const FRAME_COLOR = 0xeeebe4;

/**
 * Texture repeat per metre: geometry UVs are in world metres, so one tile of `tile_size_m`
 * metres needs a repeat of 1 / size.
 */
export function tileRepeat(material: Pick<Material, 'tile_size_m'>): [number, number] {
  return [1 / material.tile_size_m[0], 1 / material.tile_size_m[1]];
}

/** A standard PBR material for a scene material; `texture` is its loaded tileable texture, if any. */
export function createSurfaceMaterial(
  material: Material,
  texture: THREE.Texture | null = null,
): THREE.MeshStandardMaterial {
  const result = new THREE.MeshStandardMaterial();
  applySurfaceMaterial(result, material, texture);
  return result;
}

/** Make `target` show `material` with `texture` (which replaces its current map). */
export function applySurfaceMaterial(
  target: THREE.MeshStandardMaterial,
  material: Material,
  texture: THREE.Texture | null,
): void {
  target.name = material.name;
  target.color.set(material.color);
  target.roughness = material.roughness;
  target.metalness = material.metalness;
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...tileRepeat(material));
  }
  // Adding or removing a map changes the shader program.
  if ((target.map === null) !== (texture === null)) target.needsUpdate = true;
  target.map = texture;
}

/** Window glass: real transmission on medium and high, plain transparency on low (much cheaper). */
export function createGlassMaterial(quality: QualityPreset): THREE.MeshPhysicalMaterial {
  const glass = new THREE.MeshPhysicalMaterial({
    name: 'Glass',
    color: 0xdfeef2,
    roughness: 0.05,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  if (quality === 'low') {
    glass.transparent = true;
    glass.opacity = 0.25;
    glass.depthWrite = false;
  } else {
    glass.transmission = 1;
    glass.thickness = 0.01;
    glass.ior = 1.5;
  }
  return glass;
}

/** Options for {@link MaterialLibrary}. */
export interface MaterialLibraryOptions {
  quality: QualityPreset;
  /** URL of a texture asset; without it, textures are not loaded (e.g. in tests). */
  textureUrl?: (assetId: string) => string;
}

/** Stand-in for a material id the scene does not define. */
const MISSING: Material = {
  name: 'Missing material',
  color: '#9a9a9a',
  texture_asset: null,
  tile_size_m: [1, 1],
  roughness: 0.9,
  metalness: 0,
  source: 'default',
};

/**
 * Creates three.js materials on first use and shares them between meshes. {@link update} changes
 * them in place, so meshes show edited or newly added materials without being rebuilt.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();
  /** Texture asset loaded for each scene material key. */
  private readonly assets = new Map<string, string>();
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private materials: Readonly<Record<string, Material>>,
    private readonly options: MaterialLibraryOptions,
  ) {}

  /** The material for a scene material id or one of the built-in keys. */
  get(key: string): THREE.Material {
    let material = this.cache.get(key);
    if (!material) {
      material = this.create(key);
      this.cache.set(key, material);
    }
    return material;
  }

  /** Switch to the scene's current materials, updating every material handed out so far. */
  update(materials: Readonly<Record<string, Material>>): void {
    this.materials = materials;
    for (const [key, material] of this.cache) {
      if (!BUILT_IN.has(key)) this.applyScene(key, material as THREE.MeshStandardMaterial);
    }
  }

  /** Dispose every created material and its texture. */
  dispose(): void {
    for (const material of this.cache.values()) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
    this.cache.clear();
    this.assets.clear();
  }

  private create(key: string): THREE.Material {
    if (key === GLASS_MATERIAL) return createGlassMaterial(this.options.quality);
    if (key === REVEAL_MATERIAL)
      return new THREE.MeshStandardMaterial({ color: REVEAL_COLOR, roughness: 0.9 });
    if (key === FRAME_MATERIAL)
      return new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.6 });
    const material = new THREE.MeshStandardMaterial();
    this.applyScene(key, material);
    return material;
  }

  /** Make `target` show scene material `key` (grey if the scene lacks it), reusing its texture if unchanged. */
  private applyScene(key: string, target: THREE.MeshStandardMaterial): void {
    const material = this.materials[key] ?? MISSING;
    const asset = this.options.textureUrl ? material.texture_asset : null;
    let texture = target.map;
    if (this.assets.get(key) !== (asset ?? undefined)) {
      texture?.dispose();
      texture = null;
      this.assets.delete(key);
      if (asset && this.options.textureUrl) {
        texture = this.loader.load(this.options.textureUrl(asset));
        this.assets.set(key, asset);
      }
    }
    applySurfaceMaterial(target, material, texture);
  }
}
