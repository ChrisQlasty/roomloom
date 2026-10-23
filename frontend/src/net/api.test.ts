import { describe, expect, it } from 'vitest';
import { assetUrl, fetchHealth, fetchScene } from './api';

const respond =
  (status: number, body: unknown): typeof fetch =>
  async () =>
    new Response(JSON.stringify(body), { status });

describe('fetchHealth', () => {
  it('returns ok when the backend reports ok', async () => {
    expect(await fetchHealth(respond(200, { status: 'ok' }))).toBe('ok');
  });

  it('returns down on an error status', async () => {
    expect(await fetchHealth(respond(502, {}))).toBe('down');
  });

  it('returns down on an unexpected body', async () => {
    expect(await fetchHealth(respond(200, { status: 'starting' }))).toBe('down');
  });

  it('returns down when the request fails', async () => {
    const failing: typeof fetch = async () => {
      throw new TypeError('network');
    };
    expect(await fetchHealth(failing)).toBe('down');
  });

  it('returns down when the backend never answers', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    expect(await fetchHealth(hanging, 10)).toBe('down');
  });
});

describe('fetchScene', () => {
  it('returns the scene of the project', async () => {
    let url = '';
    const fetchFn: typeof fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ version: 3 }), { status: 200 });
    };
    expect(await fetchScene('example-l-house', fetchFn)).toEqual({ version: 3 });
    expect(url).toBe('/api/projects/example-l-house/scene');
  });

  it('throws on an error status', async () => {
    await expect(fetchScene('missing', respond(404, {}))).rejects.toThrow('HTTP 404');
  });
});

describe('assetUrl', () => {
  it('points at the asset endpoint', () => {
    expect(assetUrl('p', 'ast_x')).toBe('/api/projects/p/assets/ast_x');
  });
});
