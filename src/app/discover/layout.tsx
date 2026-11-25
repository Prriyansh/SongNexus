import DiscoverShell from "@/discover/components/DiscoverShell";
import "@/discover/discover.css";

export default function DiscoverLayout({ children }: LayoutProps<"/discover">) {
  return (
    <DiscoverShell>
      <main className="main-content dx-main">
        {children}
        <footer>
          <span>SONG NEXUS</span>
          <span>
            Artists, songs, credits, labels and events from <a href="https://musicbrainz.org">MusicBrainz</a> (CC0; genres CC BY-NC-SA) and{" "}
            <a href="https://www.discogs.com">Discogs</a> genres (CC0); descriptions and awards from <a href="https://www.wikidata.org">Wikidata</a> (CC0);
            listeners from <a href="https://listenbrainz.org">ListenBrainz</a> (CC0); covers from the <a href="https://coverartarchive.org">Cover Art Archive</a>;
            chart totals from the Billboard Hot 100 and Billboard 200; Eurovision entries from the{" "}
            <a href="https://github.com/Spijkervet/eurovision-dataset">Eurovision Song Contest Dataset</a> (CC BY 4.0).
            Covers a fixed catalog, so missing credits don’t mean two artists never met.
          </span>
        </footer>
      </main>
    </DiscoverShell>
  );
}
