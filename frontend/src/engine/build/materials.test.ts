import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Material } from '../../types/scene';
import {
  createGlassMaterial,
  createSurfaceMaterial,
  GLASS_MATERIAL,
  MaterialLibrary,
  REVEAL_MATERIAL,
  tileRepeat,
} from './materials';

const GYM_FLOOR: Material = {
  name: 'Gym floor',
  color: '#c08a4e',
  texture_asset: null,
  tile_size_m: [2, 0.5],
  roughness: 0.5,
  metalness: 0,
  source: 'user',
};

describe('tileRepeat', () => {
  it('turns tile size in metres into a per-metre repeat', () => {
    expect(tileRepeat(GYM_FLOOR)).toEqual([0.5, 2]);
  });
});

describe('createSurfaceMaterial', () => {
  it('copies colour and PBR values and scales a texture by the tile size', () => {
    const texture = new THREE.Texture();
    const material = createSurfaceMaterial(GYM_FLOOR, texture);
    expect(material.color.getHexString()).toBe(new THREE.Color('#c08a4e').getHexString());
    expect(material.roughness).toBe(0.5);
    expect(material.map).toBe(texture);
    expect(texture.repeat.toArray()).toEqual([0.5, 2]);
    expect(texture.wrapS).toBe(THREE.RepeatWrapping);
    expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
  });
});

describe('createGlassMaterial', () => {
  it('uses transmission except on the low preset', () => {
    expect(createGlassMaterial('low').transmission).toBe(0);
    expect(createGlassMaterial('low').transparent).toBe(true);
    expect(createGlassMaterial('medium').transmission).toBe(1);
    expect(createGlassMaterial('high').transmission).toBe(1);
  });
});

describe('MaterialLibrary', () => {
  it('creates each material once and knows the built-ins', () => {
    const library = new MaterialLibrary({ mat_gym_floor: GYM_FLOOR }, { quality: 'low' });
    expect(library.get('mat_gym_floor')).toBe(library.get('mat_gym_floor'));
    expect(library.get(GLASS_MATERIAL)).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(library.get(REVEAL_MATERIAL)).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(library.get('mat_missing')).toBeInstanceOf(THREE.MeshStandardMaterial);
    library.dispose();
  });

  it('updates handed-out materials in place, including ids that were missing', () => {
    const library = new MaterialLibrary({ mat_gym_floor: GYM_FLOOR }, { quality: 'low' });
    const floor = library.get('mat_gym_floor') as THREE.MeshStandardMaterial;
    const added = library.get('mat_new') as THREE.MeshStandardMaterial;
    const grey = added.color.getHex();
    library.update({
      mat_gym_floor: { ...GYM_FLOOR, color: '#112233', roughness: 0.2 },
      mat_new: { ...GYM_FLOOR, color: '#445566' },
    });
    expect(library.get('mat_gym_floor')).toBe(floor);
    expect(floor.color.getHexString()).toBe(new THREE.Color('#112233').getHexString());
    expect(floor.roughness).toBe(0.2);
    expect(library.get('mat_new')).toBe(added);
    expect(added.color.getHex()).not.toBe(grey);
    library.dispose();
  });
});
