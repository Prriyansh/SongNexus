import type { Metadata } from "next";
import Link from "next/link";
import EntitySearch from "@/discover/components/EntitySearch";

export const metadata: Metadata = { title: "Not found · Song Nexus" };

export default function DiscoverNotFound() {
  return (
    <div className="dx-panel dx-empty">
      <h1>That isn’t in this catalog</h1>
      <p>
        Discover covers a fixed selection of artists, songs, labels and genres, so not everything on
        MusicBrainz has a page here. Try a search.
      </p>
      <EntitySearch
        label="Search Discover"
        placeholder="An artist, song, label or genre"
        kinds={["artist", "song", "label", "genre"]}
      />
      <p>
        <Link className="dx-button dx-quiet" href="/discover">
          Back to Discover
        </Link>
      </p>
    </div>
  );
}
