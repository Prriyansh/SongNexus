export class AccountApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Same-origin session requests. Provider tokens never enter browser storage. */
export async function accountApi<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'same-origin', cache: 'no-store', signal,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'x-requested-with': 'SongNexus' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok) throw new AccountApiError(data.error || 'The request failed. Please try again.', response.status);
  return data as T;
}

type MusicKitInstance = { authorize(): Promise<string> };
type MusicKitApi = { configure(config: unknown): Promise<MusicKitInstance> | MusicKitInstance };
declare global { interface Window { MusicKit?: MusicKitApi } }
let loadingKit: Promise<void> | undefined;

export async function authorizeAppleMusic(): Promise<string> {
  const { developerToken } = await accountApi<{ developerToken: string }>('/api/integrations/apple-music/token');
  if (!window.MusicKit) {
    await (loadingKit ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
      script.async = true;
      const timer = setTimeout(() => { cleanup(); script.remove(); reject(new Error('Apple Music took too long to load. Please try again.')); }, 20_000);
      const ready = () => { cleanup(); resolve(); };
      const cleanup = () => { clearTimeout(timer); document.removeEventListener('musickitloaded', ready); };
      document.addEventListener('musickitloaded', ready, { once: true });
      script.onerror = () => { cleanup(); script.remove(); reject(new Error('Apple Music could not be loaded.')); };
      document.head.appendChild(script);
    }).catch(error => { loadingKit = undefined; throw error; }));
  }
  if (!window.MusicKit) throw new Error('Apple Music is unavailable in this browser.');
  const kit = await window.MusicKit.configure({ developerToken, app: { name: 'Song Nexus', build: '1.0.0' } });
  return kit.authorize();
}
