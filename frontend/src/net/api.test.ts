import { describe, expect, it } from 'vitest';
import { fetchHealth } from './api';

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
