import Link from 'next/link';

export const metadata = { title: 'Music account privacy | Song Nexus' };

export default function Privacy() {
  return <main className="music-accounts" style={{ padding: '40px 24px', maxWidth: 850 }}>
    <h1>Music account privacy</h1>
    <p>Song Nexus stores only the music account information you authorize and the exports you choose to upload. Connections can include your provider identity, saved music, playlists and the listening activity that provider actually makes available.</p>
    <h2>How your data is used</h2>
    <p>Your music is shown back to you in private, source-labeled views. Spotify, YouTube, Apple Music, SoundCloud and TIDAL data stay separate. Combining permitted open sources requires an explicit setting. Account data is never sent to AI models. Song Nexus does not request provider passwords or browser session cookies.</p>
    <h2>Storage and access</h2>
    <p>Provider credentials are encrypted on the server. Song Nexus passwords are hashed; session cookies are HttpOnly. Music data belongs to your Song Nexus account and is not included in public profile-sharing links. Your hosting operator controls the database, deployment logs and backups.</p>
    <h2>Your controls</h2>
    <p>In <Link href="/accounts">Connected Music Accounts</Link>, disconnect a provider to remove its credentials and synced data, delete an import to remove its snapshot, turn off combining sources, or delete your Song Nexus account and all its stored music with your password. You can also revoke authorization in the provider’s own account settings. Imported files are independent snapshots and have separate delete controls.</p>
    <h2>Retention</h2>
    <p>Connected data is kept to provide your private music library until you disconnect or delete your account. YouTube API data that cannot be refreshed within 30 days is removed. Abandoned import staging and progress events expire after one day; finished job records expire after 14 days. Backup retention depends on your deployment operator.</p>
    <h2>YouTube and Google</h2>
    <p>Using the YouTube connection is subject to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a> and <a href="https://policies.google.com/privacy">Google Privacy Policy</a>. You can revoke access on your <a href="https://security.google.com/settings/security/permissions">Google account permissions page</a>. Google authorization does not grant a complete YouTube Music library or listening history.</p>
    <p><Link href="/accounts">Return to music accounts</Link></p>
  </main>;
}
