export type WebCamera = { x: number; y: number; zoom: number };
export type MapPoint = { x: number; y: number };

export const MIN_WEB_ZOOM = .62;
export const MAX_WEB_ZOOM = 4;
export const initialWebCamera = (): WebCamera => ({ x: 0, y: 0, zoom: 1 });

/** Keep the world point under the pointer fixed as the camera zoom changes. */
export function zoomWebCamera(camera: WebCamera, zoom: number, focal: MapPoint): WebCamera {
  const next = Math.max(MIN_WEB_ZOOM, Math.min(MAX_WEB_ZOOM, zoom));
  const ratio = next / camera.zoom;
  return { zoom: next, x: focal.x - (focal.x - camera.x) * ratio, y: focal.y - (focal.y - camera.y) * ratio };
}

export const worldToWebScreen = (point: MapPoint, camera: WebCamera): MapPoint =>
  ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y });

export const webScreenToWorld = (point: MapPoint, camera: WebCamera): MapPoint =>
  ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });

/** Node coordinates are avatar centers: they scale with the map, while cards keep their size. */
export const webArtistCenter = (node: MapPoint, camera: WebCamera): MapPoint => worldToWebScreen(node, camera);

export function interpolateWebZoom(start: WebCamera, zoom: number, focal: MapPoint, progress: number): WebCamera {
  const t = Math.max(0, Math.min(1, progress));
  const eased = 1 - (1 - t) ** 3;
  return zoomWebCamera(start, start.zoom + (zoom - start.zoom) * eased, focal);
}
