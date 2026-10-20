
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  type Artist,
  type ArtistDetails,
  type DetailsResult,
  type Mode,
  type RecordingDetails,
  type Result,
  type Song,
  formatDuration,
  formatYears,
  isRecordingDetails,
  isSong,
  partitionGenres,
} from "@/lib/types";

function SearchPicker({
  mode,
  label,
  selected,
  onSelect,
}: {
  mode: Mode;
  label: string;
  selected: Result | null;
  onSelect: (result: Result) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const trimmed = query.trim();
  const tooShort = trimmed.length < 2;

  useEffect(() => {
    // Nothing to fetch for short queries. Any previously fetched results are
    // hidden at render time (see `tooShort` gating below), so we avoid calling
    // setState synchronously in the effect body.
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError("");

      try {
        const type = mode === "songs" ? "recording" : "artist";
        const response = await fetch(
          `/api/musicbrainz/search?type=${type}&q=${encodeURIComponent(trimmed)}`
        );
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Search failed.");
        if (!cancelled) setResults(data.results ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed.");
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmed, mode]);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5">
      <label className="mb-2 block text-sm text-white/60">{label}</label>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={mode === "songs" ? "Search song title..." : "Search artist name..."}
        className="w-full rounded-xl border border-white/15 bg-[#1b1d19] px-4 py-3 outline-none focus:border-lime-300"
      />

      <div className="mt-3 min-h-6 text-sm text-white/50">
        {loading && <p>Searching MusicBrainz…</p>}
        {!tooShort && error && <p className="text-amber-200">{error}</p>}
        {trimmed.length > 0 && tooShort && (
          <p>Enter at least 2 characters.</p>
        )}
        {!tooShort && !loading && results.length > 0 && (
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {results.map((result) => (
              <button
                key={result.id}
                onClick={() => {
                  onSelect(result);
                  setQuery("");
                  setResults([]);
                }}
                className="block w-full rounded-lg border border-white/10 p-3 text-left transition hover:border-lime-300/60 hover:bg-lime-300/[0.06]"
              >
                <span className="block font-medium text-white">
                  {isSong(result)
                    ? result.title
                    : result.name}
                </span>
                <span className="mt-1 block text-xs text-white/50">
                  {isSong(result)
                    ? result.artists.map((artist) => artist.name).join(", ") || "Artist unavailable"
                    : [result.type, result.country, result.disambiguation]
                        .filter(Boolean)
                        .join(" · ") || "Artist"}
                </span>
              </button>
            ))}
          </div>
        )}
        {!tooShort && !loading && !error && results.length === 0 && (
          <p>No results yet. Try another search.</p>
        )}
      </div>

      {selected && (
        <div className="mt-4 rounded-xl border border-lime-300/25 bg-lime-300/[0.06] p-4">
          <p className="text-xs uppercase tracking-wider text-lime-300">Selected</p>
          <p className="mt-1 font-semibold">
            {isSong(selected) ? selected.title : selected.name}
          </p>
          <p className="mt-1 text-sm text-white/60">
            {isSong(selected)
              ? selected.artists.map((artist) => artist.name).join(", ")
              : [selected.type, selected.country].filter(Boolean).join(" · ")}
          </p>
          <button
            onClick={() => onSelect(null as unknown as Result)}
            className="mt-2 text-xs text-white/45 underline hover:text-white"
          >
            Clear selection
          </button>
        </div>
      )}
    </div>
  );
}

// --- Comparison (enriched via MusicBrainz lookup) --------------------------

async function fetchDetails(
  type: "recording" | "artist",
  id: string,
  signal: AbortSignal
): Promise<DetailsResult> {
  const response = await fetch(
    `/api/musicbrainz/details?type=${type}&id=${encodeURIComponent(id)}`,
    { signal }
  );
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || "Could not load details.");
    (error as Error & { retryable?: boolean }).retryable = Boolean(data.retryable);
    throw error;
  }
  return data.details as DetailsResult;
}

/** Album / release artwork from Cover Art Archive, with a graceful fallback. */
function Art({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (!url || failed) {
    return (
      <div
        className="flex aspect-square w-full items-center justify-center rounded-md bg-white/[0.06] text-2xl text-white/25"
        aria-hidden
      >
        ♪
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- Cover Art Archive 307-redirects to archive.org; a plain <img> follows it and lets us hide broken art via onError.
    <img
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="aspect-square w-full rounded-md object-cover"
    />
  );
}

function GenreChips({
  genres,
  highlight,
}: {
  genres: string[];
  highlight: Set<string>;
}) {
  if (!genres.length) {
    return <span className="text-sm text-white/40">No genres catalogued</span>;
  }
  return (
    <div className="flex flex-wrap gap-2">
      {genres.slice(0, 10).map((name) => (
        <span
          key={name}
          className={
            highlight.has(name)
              ? "rounded-full bg-lime-300/20 px-3 py-1 text-xs font-medium text-lime-200 ring-1 ring-lime-300/40"
              : "rounded-full bg-white/10 px-3 py-1 text-xs text-white/70"
          }
        >
          {name}
        </span>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/10 pt-3">
      <dt className="text-white/50">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Rating({ rating }: { rating: { value: number; votes: number } | null }) {
  if (!rating) return <span className="text-white/45">Not rated</span>;
  return (
    <span>
      {rating.value.toFixed(1)}
      <span className="text-white/45">/5</span>{" "}
      <span className="text-xs text-white/45">
        ({rating.votes} {rating.votes === 1 ? "vote" : "votes"})
      </span>
    </span>
  );
}

function LinkRow({ links }: { links: { type: string; url: string }[] }) {
  if (!links.length) return null;
  return (
    <div className="mt-5 border-t border-white/10 pt-4">
      <p className="mb-2 text-sm text-white/50">Listen & learn more</p>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => (
          <a
            key={link.type}
            href={link.url}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs capitalize text-white/75 transition hover:border-lime-300/60 hover:text-white"
          >
            {link.type}
          </a>
        ))}
      </div>
    </div>
  );
}

function ArtistCard({ label, data }: { label: string; data: ArtistDetails }) {
  const d = data.discography;
  const counts = [
    d.albumCount ? `${d.albumCount} album${d.albumCount === 1 ? "" : "s"}` : "",
    d.epCount ? `${d.epCount} EP${d.epCount === 1 ? "" : "s"}` : "",
    d.singleCount ? `${d.singleCount} single${d.singleCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean);

  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
      <p className="text-xs uppercase tracking-widest text-lime-300">{label}</p>
      <h3 className="mt-3 text-2xl font-bold">{data.name}</h3>
      {data.disambiguation && (
        <p className="mt-1 text-sm text-white/55">{data.disambiguation}</p>
      )}

      <dl className="mt-6 space-y-3 text-sm">
        <Field label="Origin">
          {data.area || data.country || "Not available"}
          {data.area && data.country ? ` (${data.country})` : ""}
        </Field>
        <Field label="Type">
          {[data.type, data.gender].filter(Boolean).join(" · ") || "Not available"}
        </Field>
        <Field label="Active period">
          {formatYears(data.lifeSpan.begin ?? "", data.lifeSpan.end ?? "", data.lifeSpan.ended)}
        </Field>
        <Field label="MusicBrainz community rating">
          <Rating rating={data.rating} />
        </Field>
        <Field label="Catalogue">
          {counts.length ? counts.join(" · ") : "Not available"}
          {d.firstYear && (
            <span className="text-white/45">
              {" "}
              · {d.firstYear}
              {d.lastYear && d.lastYear !== d.firstYear ? `–${d.lastYear}` : ""}
            </span>
          )}
        </Field>
      </dl>

      {data.discography.representative.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="mb-2 text-sm text-white/50">Representative albums</p>
          <div className="grid grid-cols-3 gap-3">
            {data.discography.representative.slice(0, 3).map((album) => (
              <div key={album.id}>
                <Art url={album.artUrl} alt={`${album.title} cover`} />
                <p className="mt-1.5 truncate text-xs font-medium" title={album.title}>
                  {album.title}
                </p>
                {album.year && <p className="text-xs text-white/45">{album.year}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      <LinkRow links={data.links} />
    </article>
  );
}

function SongCard({ label, data }: { label: string; data: RecordingDetails }) {
  return (
    <article className="rounded-2xl border border-white/10 bg-white/[0.04] p-6">
      <p className="text-xs uppercase tracking-widest text-lime-300">{label}</p>
      <div className="mt-3 flex gap-4">
        <div className="w-20 shrink-0">
          <Art url={data.representative?.artUrl ?? null} alt={`${data.title} cover`} />
        </div>
        <div className="min-w-0">
          <h3 className="text-2xl font-bold leading-tight">{data.title}</h3>
          <p className="mt-1 text-white/65">
            {data.artists.map((a) => a.name).join(", ") || "Artist unavailable"}
          </p>
        </div>
      </div>

      <dl className="mt-6 space-y-3 text-sm">
        <Field label="Duration">{formatDuration(data.durationMs)}</Field>
        <Field label="First released">{data.firstReleaseDate || "Not available"}</Field>
        <Field label="Appears on">
          {data.representative
            ? `${data.representative.title}${data.representative.year ? ` (${data.representative.year})` : ""}`
            : "Not available"}
        </Field>
        <Field label="MusicBrainz community rating">
          <Rating rating={data.rating} />
        </Field>
      </dl>

      <LinkRow links={data.links} />
    </article>
  );
}

function Insights({ a, b }: { a: DetailsResult; b: DetailsResult }) {
  const { shared, onlyA, onlyB } = partitionGenres(a.genres, b.genres);
  const bothHaveGenres = a.genres.length > 0 && b.genres.length > 0;

  const facts: string[] = [];
  if (isRecordingDetails(a) && isRecordingDetails(b)) {
    if (a.durationMs != null && b.durationMs != null) {
      facts.push(
        `Duration gap: ${formatDuration(Math.abs(a.durationMs - b.durationMs))}.`
      );
    } else {
      facts.push("Duration gap can't be shown — missing for at least one recording.");
    }
  } else if (!isRecordingDetails(a) && !isRecordingDetails(b)) {
    if (a.country && b.country) {
      facts.push(
        a.country === b.country
          ? `Both originate from ${a.country}.`
          : `Different origins: ${a.country} vs ${b.country}.`
      );
    }
    if (a.lifeSpan.begin && b.lifeSpan.begin) {
      facts.push(
        `Careers began ${a.lifeSpan.begin} and ${b.lifeSpan.begin}.`
      );
    }
    if (a.discography.albumCount || b.discography.albumCount) {
      facts.push(
        `Catalogued albums: ${a.discography.albumCount} vs ${b.discography.albumCount}.`
      );
    }
  }

  return (
    <article className="mt-4 rounded-2xl border border-lime-300/20 bg-lime-300/[0.06] p-6">
      <p className="text-sm font-semibold text-lime-300">Insights (derived)</p>

      <div className="mt-3">
        <p className="text-sm text-white/55">Genre overlap</p>
        {bothHaveGenres ? (
          shared.length ? (
            <>
              <div className="mt-2">
                <GenreChips genres={shared} highlight={new Set(shared)} />
              </div>
              <p className="mt-2 text-sm text-white/70">
                {shared.length} shared genre{shared.length === 1 ? "" : "s"} in
                MusicBrainz&apos;s community data. These describe how listeners
                categorise the music, not measured audio similarity.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-white/70">
              No genres in common. {onlyA.length + onlyB.length > 0
                ? "Each is tagged with distinct genres below."
                : ""}
            </p>
          )
        ) : (
          <p className="mt-2 text-sm text-white/70">
            Genre overlap can&apos;t be assessed — MusicBrainz has no curated
            genres for at least one of these yet.
          </p>
        )}

        {(onlyA.length > 0 || onlyB.length > 0) && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs text-white/45">Distinct to the first</p>
              <div className="mt-1.5">
                <GenreChips genres={onlyA} highlight={new Set()} />
              </div>
            </div>
            <div>
              <p className="text-xs text-white/45">Distinct to the second</p>
              <div className="mt-1.5">
                <GenreChips genres={onlyB} highlight={new Set()} />
              </div>
            </div>
          </div>
        )}
      </div>

      {facts.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-lime-300/15 pt-4 text-sm text-white/75">
          {facts.map((fact) => (
            <li key={fact}>• {fact}</li>
          ))}
        </ul>
      )}

      <p className="mt-4 text-xs text-white/40">
        Not shown: popularity, play counts and audio features (tempo, energy,
        danceability, mood). No currently configured source provides these, so
        they are omitted rather than estimated.
      </p>
    </article>
  );
}

function ComparisonSkeleton() {
  return (
    <div className="grid animate-pulse gap-4 md:grid-cols-2" aria-hidden>
      {[0, 1].map((i) => (
        <div key={i} className="h-72 rounded-2xl border border-white/10 bg-white/[0.04]" />
      ))}
    </div>
  );
}

function ComparisonResult({
  mode,
  firstId,
  secondId,
}: {
  mode: Mode;
  firstId: string;
  secondId: string;
}) {
  // Starts in the loading state. The parent gives this component a `key` tied
  // to the selected items, so changing a selection remounts it fresh rather
  // than resetting state synchronously inside the effect. Retry is driven from
  // the button's event handler below (also outside the effect).
  const [data, setData] = useState<[DetailsResult, DetailsResult] | null>(null);
  const [error, setError] = useState("");
  const [retryable, setRetryable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const type = mode === "songs" ? "recording" : "artist";

    Promise.all([
      fetchDetails(type, firstId, controller.signal),
      fetchDetails(type, secondId, controller.signal),
    ])
      .then((pair) => {
        setData(pair);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Could not load details.");
        setRetryable(Boolean((err as { retryable?: boolean })?.retryable));
        setLoading(false);
      });

    return () => controller.abort();
  }, [mode, firstId, secondId, attempt]);

  function retry() {
    setData(null);
    setError("");
    setLoading(true);
    setAttempt((n) => n + 1);
  }

  const labels =
    mode === "songs" ? (["Song A", "Song B"] as const) : (["Artist A", "Artist B"] as const);

  return (
    <section className="mt-12">
      <h2 className="mb-5 text-2xl font-bold">Your comparison</h2>

      {loading && <ComparisonSkeleton />}

      {!loading && error && (
        <div className="rounded-2xl border border-amber-300/30 bg-amber-300/[0.06] p-6">
          <p className="font-medium text-amber-100">{error}</p>
          {retryable && (
            <button
              onClick={retry}
              className="mt-3 rounded-lg bg-lime-300 px-4 py-2 text-sm font-semibold text-black transition hover:bg-lime-200"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {data.map((item, index) =>
              isRecordingDetails(item) ? (
                <SongCard key={item.id} label={labels[index]} data={item} />
              ) : (
                <ArtistCard key={item.id} label={labels[index]} data={item} />
              )
            )}
          </div>
          <Insights a={data[0]} b={data[1]} />
        </>
      )}
    </section>
  );
}

export default function Home() {
  const [mode, setMode] = useState<Mode>("songs");
  const [songA, setSongA] = useState<Song | null>(null);
  const [songB, setSongB] = useState<Song | null>(null);
  const [artistA, setArtistA] = useState<Artist | null>(null);
  const [artistB, setArtistB] = useState<Artist | null>(null);
  const [compared, setCompared] = useState(false);

  function changeMode(next: Mode) {
    setMode(next);
    setCompared(false);
  }

  const first = mode === "songs" ? songA : artistA;
  const second = mode === "songs" ? songB : artistB;

  function chooseFirst(result: Result | null) {
    if (mode === "songs") setSongA(result && isSong(result) ? result : null);
    else setArtistA(result && !isSong(result) ? result : null);
    setCompared(false);
  }

  function chooseSecond(result: Result | null) {
    if (mode === "songs") setSongB(result && isSong(result) ? result : null);
    else setArtistB(result && !isSong(result) ? result : null);
    setCompared(false);
  }

  return (
    <main className="min-h-screen bg-[#10110f] text-[#f4f2eb]">
      <header className="border-b border-white/10 px-6 py-5">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <Link href="/" className="text-xl font-bold tracking-tight">
            Song<span className="text-lime-300">Nexus</span>
          </Link>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/65">
            MUSIC DISCOVERY LAB
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-12 md:py-16">
        <p className="mb-3 text-sm font-semibold uppercase tracking-[0.25em] text-lime-300">
          Hear the connections
        </p>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          What do your favorite sounds have in common?
        </h1>
        <p className="mt-5 max-w-2xl leading-7 text-white/60">
          Compare real songs and artists, understand shared attributes, and
          explore documented connections. Results depend on available metadata.
        </p>

        <div className="mt-9 inline-flex rounded-xl border border-white/10 bg-white/[0.04] p-1">
          {(["songs", "artists"] as Mode[]).map((item) => (
            <button
              key={item}
              onClick={() => changeMode(item)}
              className={`rounded-lg px-5 py-3 text-sm font-semibold transition ${
                mode === item
                  ? "bg-lime-300 text-black"
                  : "text-white/65 hover:text-white"
              }`}
            >
              {item === "songs" ? "Song comparison" : "Artist comparison"}
            </button>
          ))}
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <SearchPicker
            mode={mode}
            label={mode === "songs" ? "Song A" : "Artist A"}
            selected={first}
            onSelect={chooseFirst}
          />
          <SearchPicker
            mode={mode}
            label={mode === "songs" ? "Song B" : "Artist B"}
            selected={second}
            onSelect={chooseSecond}
          />
        </div>

        <button
          onClick={() => setCompared(true)}
          disabled={!first || !second || first.id === second.id}
          className="mt-5 rounded-xl bg-lime-300 px-6 py-3.5 font-bold text-black transition hover:bg-lime-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Compare {mode} →
        </button>

        {first && second && first.id === second.id && (
          <p className="mt-3 text-sm text-amber-200">
            Select two different results to compare them.
          </p>
        )}

        {compared && first && second && first.id !== second.id && (
          <ComparisonResult
            key={`${mode}:${first.id}:${second.id}`}
            mode={mode}
            firstId={first.id}
            secondId={second.id}
          />
        )}

        <p className="mt-12 text-sm text-white/35">
          Powered by MusicBrainz and the Cover Art Archive. Facts come from
          catalogued metadata; insights are derived from it and labelled as such.
          Audio features such as tempo, energy, danceability and mood are not
          available from these sources and are never estimated.
        </p>
      </section>
    </main>
  );
}
