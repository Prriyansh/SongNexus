export type WebCamera = { x: number; y: number; zoom: number };
export type MapPoint = { x: number; y: number };

export const MIN_WEB_ZOOM = .62;
export const MAX_WEB_ZOOM = 4;
export const initialWebCamera = (): WebCamera => ({ x: 0, y: 0, zoom: 1 });
export const scopeForZoom = (zoom: number) => zoom >= 1.3 ? -1 : zoom >= .95 ? 0 : zoom >= .78 ? 1 : 2;
export const zoomForScope = (scope: number) => [1.6, 1, .85, .68][Math.max(0, Math.min(3, scope + 1))];

/** Keep the world point under the pointer fixed as the camera zoom changes. */
export function zoomWebCamera(camera: WebCamera, zoom: number, focal: MapPoint): WebCamera {
  const next = Math.max(MIN_WEB_ZOOM, Math.min(MAX_WEB_ZOOM, zoom));
  const ratio = next / camera.zoom;
  return { zoom: next, x: focal.x - (focal.x - camera.x) * ratio, y: focal.y - (focal.y - camera.y) * ratio };
}

export const projectWebPoint = (point: MapPoint, center: MapPoint, zoom: number): MapPoint =>
  ({ x: center.x + (point.x - center.x) * zoom, y: center.y + (point.y - center.y) * zoom });

export const worldToWebScreen = (point: MapPoint, camera: WebCamera): MapPoint =>
  ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y });

export const webScreenToWorld = (point: MapPoint, camera: WebCamera): MapPoint =>
  ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });

/** The avatar center scales with the map; the card's fixed label offset does not. */
export const webArtistCenter = (node: MapPoint, camera: WebCamera): MapPoint => worldToWebScreen({ x: node.x, y: node.y - 22 }, camera);

export function interpolateWebZoom(start: WebCamera, zoom: number, focal: MapPoint, progress: number): WebCamera {
  const t = Math.max(0, Math.min(1, progress));
  const eased = 1 - (1 - t) ** 3;
  return zoomWebCamera(start, start.zoom + (zoom - start.zoom) * eased, focal);
}

export function focusArtistAt(nodes: ({ id: string } & MapPoint)[], point: MapPoint, camera: WebCamera) {
  const world = webScreenToWorld(point, camera);
  const nearest = [...nodes].sort((a, b) => Math.hypot(a.x - world.x, a.y - 22 - world.y) - Math.hypot(b.x - world.x, b.y - 22 - world.y))[0];
  return nearest ? { artistId: nearest.id, ...world } : null;
}
