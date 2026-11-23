/** Which side of a room you are on, remembered in this browser so the map shows you as "you". */
const KEY = 'songnexus.rooms.v1';
export type RoomRole = 'host' | 'guest';

function read(): Record<string, RoomRole> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object'
      ? (raw as Record<string, RoomRole>)
      : {};
  } catch {
    return {};
  }
}

export function readRoomRole(code: string): RoomRole | null {
  const role = read()[code];
  return role === 'host' || role === 'guest' ? role : null;
}

export function storeRoomRole(code: string, role: RoomRole): void {
  try {
    // Rooms last a week; keep the last few only.
    const entries = Object.entries({...read(), [code]: role}).slice(-20);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Blocked storage: the room still works, seen from the host's side.
  }
}
