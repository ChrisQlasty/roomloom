import * as THREE from 'three';
import type { Material } from '../../types/scene';

/** Render quality preset (selected in T08; the shell only needs it for glass). */
export type QualityPreset = 'low' | 'medium' | 'high';

/** Built-in materials that are not part of the scene document; `__` cannot clash with `mat_` ids. */
export const REVEAL_MATERIAL = '__reveal';
export const FRAME_MATERIAL = '__frame';
export const GLASS_MATERIAL = '__glass';

const REVEAL_COLOR = 0xd9d4c8;
const FRAME_COLOR = 0xeeebe4;
const MISSING_COLOR = 0x9a9a9a;

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
  const result = new THREE.MeshStandardMaterial({
    name: material.name,
    color: new THREE.Color(material.color),
    roughness: material.roughness,
    metalness: material.metalness,
  });
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...tileRepeat(material));
    result.map = texture;
  }
  return result;
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

/** Creates three.js materials on first use and shares them between meshes. */
export class MaterialLibrary {
  private readonly cache = new Map<string, THREE.Material>();
  private readonly loader = new THREE.TextureLoader();

  constructor(
    private readonly materials: Readonly<Record<string, Material>>,
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

  /** Dispose every created material and its texture. */
  dispose(): void {
    for (const material of this.cache.values()) {
      if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose();
      material.dispose();
    }
    this.cache.clear();
  }

  private create(key: string): THREE.Material {
    if (key === GLASS_MATERIAL) return createGlassMaterial(this.options.quality);
    if (key === REVEAL_MATERIAL)
      return new THREE.MeshStandardMaterial({ color: REVEAL_COLOR, roughness: 0.9 });
    if (key === FRAME_MATERIAL)
      return new THREE.MeshStandardMaterial({ color: FRAME_COLOR, roughness: 0.6 });
    const material = this.materials[key];
    if (!material) return new THREE.MeshStandardMaterial({ color: MISSING_COLOR, roughness: 0.9 });
    const { textureUrl } = this.options;
    const texture =
      material.texture_asset && textureUrl
        ? this.loader.load(textureUrl(material.texture_asset))
        : null;
    return createSurfaceMaterial(material, texture);
  }
}
