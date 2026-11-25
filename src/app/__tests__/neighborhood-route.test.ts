import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpstreamError } from '@/lib/musicbrainz';

const discover = vi.hoisted(() => vi.fn());
vi.mock('@/lib/artist-neighborhood', () => ({ artistNeighborhood: discover }));
import { GET, maxDuration } from '../api/musicbrainz/neighborhood/route';
const ID = 'aa000000-0000-4000-8000-000000000001';
beforeEach(() => { discover.mockReset(); });

describe('artist neighborhood route', () => {
  it('rejects malformed identifiers before making catalog calls', async () => {
    const result = await GET(new Request('http://localhost/api/musicbrainz/neighborhood?id=invalid'));
    expect(result.status).toBe(400); expect(discover).not.toHaveBeenCalled();
  });
  it('caches complete results and keeps partial results retryable', async () => {
    discover.mockResolvedValue({ artists: [], failed: [] });
    const complete = await GET(new Request(`http://localhost/api/musicbrainz/neighborhood?id=${ID}`));
    expect(complete.status).toBe(200); expect(complete.headers.get('Cache-Control')).toContain('max-age=');
    discover.mockResolvedValue({ artists: [], failed: ['labels'] });
    const partial = await GET(new Request(`http://localhost/api/musicbrainz/neighborhood?id=${ID}`));
    expect(partial.status).toBe(200); expect(partial.headers.get('Cache-Control')).toBe('no-store');
    expect(maxDuration).toBeGreaterThanOrEqual(30);
  });
  it('returns upstream retry metadata on a failed anchor lookup', async () => {
    discover.mockRejectedValue(new UpstreamError('Catalog busy', 503, true));
    const result = await GET(new Request(`http://localhost/api/musicbrainz/neighborhood?id=${ID}`));
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ retryable: true });
  });
});
