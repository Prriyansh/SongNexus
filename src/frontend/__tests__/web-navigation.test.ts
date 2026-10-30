import { describe, expect, it } from 'vitest';
import { focusArtistAt, initialWebCamera, interpolateWebZoom, MAX_WEB_ZOOM, MIN_WEB_ZOOM, projectWebPoint, scopeForZoom, webArtistCenter, webScreenToWorld, worldToWebScreen, zoomForScope, zoomWebCamera } from '../web-navigation';

describe('Connection Web camera', () => {
  it('keeps the world point under the scroll pointer fixed', () => {
    const camera = { x: 110, y: -55, zoom: 1 };
    const focal = { x: 230, y: 85 };
    const world = { x: (focal.x - camera.x) / camera.zoom, y: (focal.y - camera.y) / camera.zoom };
    const next = zoomWebCamera(camera, 1.5, focal);
    expect(world.x * next.zoom + next.x).toBeCloseTo(focal.x);
    expect(world.y * next.zoom + next.y).toBeCloseTo(focal.y);
    expect(zoomWebCamera(next, camera.zoom, focal)).toEqual(camera);
  });

  it('limits the camera while retaining both close and wide exploration scopes', () => {
    expect(zoomWebCamera(initialWebCamera(), 100, { x: 0, y: 0 }).zoom).toBe(MAX_WEB_ZOOM);
    expect(zoomWebCamera(initialWebCamera(), .001, { x: 0, y: 0 }).zoom).toBe(MIN_WEB_ZOOM);
    for (const scope of [-1, 0, 1, 2]) expect(scopeForZoom(zoomForScope(scope))).toBe(scope);
  });

  it('projects point positions without changing artist-card dimensions', () => {
    const point = { x: 300, y: 200 }, center = { x: 400, y: 250 };
    expect(projectWebPoint(point, center, 1)).toEqual(point);
    expect(projectWebPoint(point, center, 1.5)).toEqual({ x: 250, y: 175 });
  });

  it('resolves discovery focus through both zoom and pan', () => {
    const camera = { x: 115, y: -44, zoom: 2 };
    const focus = focusArtistAt([{ id: 'anchor', x: 100, y: 100 }, { id: 'context', x: 300, y: 240 }], { x: 715, y: 392 }, camera);
    expect(focus).toEqual({ artistId: 'context', x: 300, y: 218 });
    expect(worldToWebScreen(webScreenToWorld({ x: 715, y: 392 }, camera), camera)).toEqual({ x: 715, y: 392 });
  });

  it('scales all pair distances by the zoom ratio and moves continuously around the pointer', () => {
    const start = initialWebCamera(), focal = { x: 450, y: 270 };
    const a = { x: 180, y: 240 }, b = { x: 720, y: 310 };
    const distance = (camera: typeof start) => { const p = webArtistCenter(a, camera), q = webArtistCenter(b, camera); return Math.hypot(p.x - q.x, p.y - q.y); };
    const middle = interpolateWebZoom(start, 2, focal, .5), end = interpolateWebZoom(start, 2, focal, 1);
    expect(distance(middle)).toBeGreaterThan(distance(start));
    expect(distance(middle)).toBeLessThan(distance(end));
    expect(distance(end) / distance(start)).toBeCloseTo(2);
    expect(worldToWebScreen(webScreenToWorld(focal, start), middle)).toEqual(focal);
    expect(end).toEqual(zoomWebCamera(start, 2, focal));
  });
});
