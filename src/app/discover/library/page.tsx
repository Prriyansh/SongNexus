import Library from "@/discover/components/Library";
import { pageMetadata } from "@/discover/lib/metadata";

// About one person, so search engines leave it out.
export const metadata = {
  ...pageMetadata(
    "Library",
    "Bring your listening from ListenBrainz, Last.fm or Deezer, and see how the artists you play are connected.",
    "/discover/library",
  ),
  robots: { index: false, follow: true },
};

export default function LibraryPage() {
  return (
    <>
      <header className="dx-head">
        <h1>Library</h1>
        <p>
          Your listening from the services you use, and your Nexus: how the artists you play and love are
          connected in the credits. Kept in this browser.
        </p>
      </header>
      <Library />
    </>
  );
}
