
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  type Artist,
  type Mode,
  type Result,
  type Song,
  formatDuration,
  isSong,
  sharedTags as computeSharedTags,
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

  const sharedTags =
    first && second ? computeSharedTags(first, second) : [];

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
          <section className="mt-12">
            <h2 className="mb-5 text-2xl font-bold">Your comparison</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {[first, second].map((item, index) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] p-6"
                >
                  <p className="text-xs uppercase tracking-widest text-lime-300">
                    {mode === "songs"
                      ? index === 0 ? "Song A" : "Song B"
                      : index === 0 ? "Artist A" : "Artist B"}
                  </p>
                  <h3 className="mt-3 text-2xl font-bold">
                    {isSong(item) ? item.title : item.name}
                  </h3>

                  {isSong(item) ? (
                    <>
                      <p className="mt-1 text-white/65">
                        {item.artists.map((artist) => artist.name).join(", ") || "Artist unavailable"}
                      </p>
                      <dl className="mt-6 space-y-3 text-sm">
                        <div className="border-t border-white/10 pt-3">
                          <dt className="text-white/50">Duration</dt>
                          <dd>{formatDuration(item.durationMs)}</dd>
                        </div>
                        <div className="border-t border-white/10 pt-3">
                          <dt className="text-white/50">Release information</dt>
                          <dd className="mt-1">
                            {item.releases.length
                              ? item.releases.map((release) => `${release.title}${release.date ? ` (${release.date})` : ""}`).join(" · ")
                              : "Not available"}
                          </dd>
                        </div>
                      </dl>
                    </>
                  ) : (
                    <dl className="mt-6 space-y-3 text-sm">
                      <div className="border-t border-white/10 pt-3">
                        <dt className="text-white/50">Origin</dt>
                        <dd>{item.country || "Not available"}</dd>
                      </div>
                      <div className="border-t border-white/10 pt-3">
                        <dt className="text-white/50">Artist type</dt>
                        <dd>{item.type || "Not available"}</dd>
                      </div>
                      <div className="border-t border-white/10 pt-3">
                        <dt className="text-white/50">Active period</dt>
                        <dd>
                          {item.lifeSpan.begin || "Unknown"}
                          {item.lifeSpan.end ? ` – ${item.lifeSpan.end}` : item.lifeSpan.ended ? "" : " – Present / unknown"}
                        </dd>
                      </div>
                    </dl>
                  )}

                  <div className="mt-5 border-t border-white/10 pt-4">
                    <p className="mb-2 text-sm text-white/50">Available tags</p>
                    <div className="flex flex-wrap gap-2">
                      {item.tags.length ? item.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-white/10 px-3 py-1 text-xs">
                          {tag}
                        </span>
                      )) : <span className="text-sm text-white/40">No tags available</span>}
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <article className="mt-4 rounded-2xl border border-lime-300/20 bg-lime-300/[0.06] p-6">
              <p className="text-sm font-semibold text-lime-300">What connects them?</p>
              {sharedTags.length ? (
                <p className="mt-2 leading-7 text-white/75">
                  Shared tags in MusicBrainz: {sharedTags.join(", ")}.
                  These are shared community metadata tags, not proof that the
                  music sounds alike.
                </p>
              ) : (
                <p className="mt-2 leading-7 text-white/75">
                  No shared tags were found in these results. This does not
                  necessarily mean the songs or artists sound different.
                  MusicBrainz may have incomplete metadata.
                </p>
              )}

              {mode === "songs" && isSong(first) && isSong(second) && (
                <p className="mt-3 text-sm text-white/70">
                  {first.durationMs != null && second.durationMs != null
                    ? `Duration difference: ${formatDuration(Math.abs(first.durationMs - second.durationMs))}.`
                    : "Duration difference cannot be calculated because duration is missing for at least one recording."}
                </p>
              )}

              {mode === "artists" && !isSong(first) && !isSong(second) && (
                <p className="mt-3 text-sm text-white/70">
                  {first.country && second.country && first.country === second.country
                    ? `Both artists are listed with the same origin: ${first.country}.`
                    : "Their listed origins are different or unavailable."}
                </p>
              )}
            </article>
          </section>
        )}

        <p className="mt-12 text-sm text-white/35">
          Powered by MusicBrainz metadata. Missing information is not evidence
          of a musical difference. Mood, energy, melody and vocal similarity
          require additional data sources.
        </p>
      </section>
    </main>
  );
}
