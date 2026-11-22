// Prepares a local Song Nexus for a demo of Connected Music Accounts, without any provider
// credentials: it creates a demo account and loads three small SAMPLE imports through the same
// HTTP API the dashboard uses. Follow docs/integrations/demo.md while presenting.
//
//   node scripts/demo-seed.mjs                    seed http://127.0.0.1:3000
//   node scripts/demo-seed.mjs --reset            delete the demo account and everything it holds
//   node scripts/demo-seed.mjs http://127.0.0.1:3001
//
// The plays below are made up for the demo (the songs are real, the listening is not), every file
// is named "DEMO sample …", and the script refuses to talk to anything but a local server.
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const origin = new URL(args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:3000');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) {
  console.error('The demo seed only runs against a local server (127.0.0.1 or localhost).');
  process.exit(1);
}

// A fixed sign-in is fine here: the account lives only in this machine's development database.
const USERNAME = 'demo';
const PASSWORD = 'songnexus-demo';
let cookie = '';

async function call(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch(new URL(path, origin), {
      method,
      headers: { cookie, origin: origin.origin, 'x-requested-with': 'SongNexus', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    console.error(`Could not reach ${origin.origin}. Start the app first (demo.cmd, or npm run dev) and run this again.`);
    process.exit(1);
  }
  const data = await response.json().catch(() => ({}));
  const set = response.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  return { status: response.status, data };
}
const must = async (label, ...request) => {
  const result = await call(...request);
  if (result.status >= 400) throw new Error(`${label} failed (${result.status}): ${result.data.error ?? 'no message'}`);
  return result.data;
};

// MusicBrainz recording ids, the same two the app uses as its default song comparison. Giving
// them means those rows are identified exactly, by id, and not only by a title and an artist name.
const DRIVERS_LICENSE = '143f1c88-f47f-4f37-b25d-614c74269dea';
const BLANK_SPACE = 'c3fe7791-0a91-4f0a-a89b-b056f38d3cde';

const SONGS = [
  ['drivers license', 'Olivia Rodrigo', 'SOUR', DRIVERS_LICENSE],
  ['Blank Space', 'Taylor Swift', '1989', BLANK_SPACE],
  ['vampire', 'Olivia Rodrigo', 'GUTS'],
  ['Kill Bill', 'SZA', 'SOS'],
  ['Motion Sickness', 'Phoebe Bridgers', 'Stranger in the Alps'],
  ['Style', 'Taylor Swift', '1989'],
  ['good 4 u', 'Olivia Rodrigo', 'SOUR'],
  ['Kyoto', 'Phoebe Bridgers', 'Punisher'],
  ['Snooze', 'SZA', 'SOS'],
  ['Cruel Summer', 'Taylor Swift', 'Lover'],
];

const HOUR = 3_600_000;
const start = Date.now() - 14 * 24 * HOUR;
/** `count` plays spread over the last two weeks; early songs in the list are played more often. */
const plays = (count, offsetMinutes) => Array.from({ length: count }, (_, i) => {
  const [title, artist, album, mbid] = SONGS[i % 3 === 0 ? (i / 3) % 3 : (i * 7) % SONGS.length];
  return { t: 'play', title, artist, album, ...(mbid ? { mbid } : {}), msPlayed: 180_000 + (i % 5) * 9_000, playedAt: new Date(start + i * (14 * 24 * HOUR / count) + offsetMinutes * 60_000).toISOString() };
});

const IMPORTS = [
  {
    format: 'listenbrainz-listens', filename: 'DEMO sample listens.jsonl',
    rows: plays(60, 0),
  },
  {
    format: 'shazam-library', filename: 'DEMO sample shazamlibrary.csv',
    rows: [SONGS[0], SONGS[1], SONGS[4], SONGS[7], ['Bags', 'Clairo', 'Immunity'], ['Pink + White', 'Frank Ocean', 'Blonde']]
      .map(([title, artist, , mbid], i) => ({ t: 'library', kind: 'track', relation: 'saved', title, artist, ...(mbid ? { mbid } : {}), addedAt: new Date(start + i * 50 * HOUR).toISOString() })),
  },
  {
    // A display-only source: it shows that Spotify data stays in its own view and never joins the combined one.
    format: 'spotify-history', filename: 'DEMO sample Streaming_History_Audio.json',
    rows: plays(25, 17),
  },
  {
    format: 'generic', filename: 'DEMO sample road-trip playlist.csv',
    rows: [SONGS[9], SONGS[3], SONGS[6], SONGS[5], SONGS[8]].map(([title, artist, album]) => ({ t: 'playlist_track', playlist: 'Road trip (demo)', title, artist, album })),
  },
];

async function signIn() {
  const registered = await call('/api/auth/register', 'POST', { username: USERNAME, password: PASSWORD });
  if (registered.status === 201) return 'created';
  if (registered.status !== 409) throw new Error(`Could not create the demo account (${registered.status}): ${registered.data.error ?? ''}`);
  await must('Sign in', '/api/auth/login', 'POST', { username: USERNAME, password: PASSWORD });
  return 'existing';
}

const me = await call('/api/auth/me');
if (me.status !== 200 || !me.data.available) {
  console.error('This server has no account database. In development that should never happen; check the terminal running the app.');
  process.exit(1);
}

if (reset) {
  const login = await call('/api/auth/login', 'POST', { username: USERNAME, password: PASSWORD });
  if (login.status !== 200) { console.log('There is no demo account to remove.'); process.exit(0); }
  await must('Delete account', '/api/auth/me', 'DELETE', { password: PASSWORD });
  console.log('Demo account and all of its data deleted.');
  process.exit(0);
}

const account = await signIn();
console.log(`Demo account ${account === 'created' ? 'created' : 'already existed'}.`);

for (const file of IMPORTS) {
  // The fingerprint stands in for the file's SHA-256, so seeding twice doesn't import twice.
  const sha256 = createHash('sha256').update(`song-nexus-demo:${file.filename}`).digest('hex');
  const created = await call('/api/imports', 'POST', { format: file.format, filename: file.filename, sha256 });
  if (created.status === 409) { console.log(`  already imported: ${file.filename}`); continue; }
  if (created.status !== 201) throw new Error(`Could not start import ${file.filename} (${created.status}): ${created.data.error ?? ''}`);
  const id = created.data.import.id;
  await must('Upload rows', `/api/imports/${id}/rows`, 'POST', { batch: 0, rows: file.rows });
  const { import: done } = await must('Commit', `/api/imports/${id}/commit`, 'POST');
  const s = done.stats;
  console.log(`  imported: ${file.filename} (${[s.plays && `${s.plays} plays`, s.library && `${s.library} saved`, s.playlists && `${s.playlists} playlist`].filter(Boolean).join(', ')})`);
}

// Left off on purpose: turning on "Combine my open sources" is a step of the demo itself.
await must('Consent', '/api/auth/consents', 'PUT', { kind: 'combine_sources', granted: false });

const { providers } = await must('Providers', '/api/integrations/providers');
const ready = providers.filter(p => p.availability === 'available').map(p => p.name);
console.log(`
Ready. Open ${origin.origin}/accounts and sign in:

  username  ${USERNAME}
  password  ${PASSWORD}

Services that can be connected on this server right now: ${ready.join(', ') || 'none'}.
Everything named "DEMO sample" is made-up listening for the demo. Remove it all with:

  node scripts/demo-seed.mjs --reset
`);
