import { describe, expect, it } from 'vitest';
import { GROUND_LEVEL, groundSurface } from './ground';
import { loadExampleScene } from './test-scene';

describe('groundSurface', () => {
  const outline = loadExampleScene().shell.outline;
  const mesh = groundSurface(outline, 10);

  it('is flat at ground level and faces up', () => {
    for (let i = 1; i < mesh.positions.length; i += 3) expect(mesh.positions[i]).toBe(GROUND_LEVEL);
    for (let i = 1; i < mesh.normals.length; i += 3) expect(mesh.normals[i]).toBe(1);
  });

  it('covers the margin square minus the building footprint', () => {
    let area = 0;
    const p = (i: number): [number, number] => [mesh.positions[i * 3]!, mesh.positions[i * 3 + 2]!];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const [a, b, c] = [p(mesh.indices[t]!), p(mesh.indices[t + 1]!), p(mesh.indices[t + 2]!)];
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    }
    // 50 × 40 square around the 30 × 20 L, whose footprint is 600 − 18 × 10 = 420 m².
    expect(area).toBeCloseTo(50 * 40 - 420, 6);
  });
});
