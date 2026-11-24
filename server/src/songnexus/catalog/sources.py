"""The data-source registry: every source SongNexus uses or evaluates, with its license.

This module is the single source of truth. The ingest pipeline registers sources
from it and refuses facts from anything else; ``ListDataSources`` and the About
screen's Resources section serve it.

A source is added here *before* any code reads from it, with the license as the
provider states it and the date that was checked. Sources whose license is
unstated are not used.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass


class Tier(enum.StrEnum):
    """What a source's license allows us to do with it."""

    # CC0 or equivalent: usable in a commercial YouTube Music feature.
    PRODUCTION = "PRODUCTION"
    # Non-commercial terms: the capstone may serve it; a commercial launch drops it by source ID.
    NON_COMMERCIAL = "NON_COMMERCIAL"
    # Offline evaluation only: never stored in the catalog, never served.
    EVALUATION = "EVALUATION"


class Status(enum.StrEnum):
    """Whether the source is wired in yet."""

    IN_USE = "IN_USE"
    PLANNED = "PLANNED"


class Kind(enum.StrEnum):
    """How we obtain the data."""

    API = "API"
    DATA_DUMP = "DATA_DUMP"
    DATASET = "DATASET"  # a published research or Kaggle dataset
    USER_ACCOUNT = "USER_ACCOUNT"  # a listener's own data, through a linked account or export
    # Analysis computed live by a companion service (song_compare) from a dataset it holds;
    # results are shown with the source, never stored in the catalog.
    SERVICE = "SERVICE"


@dataclass(frozen=True)
class DataSource:
    """One provider of data.

    Attributes:
        id: Stable ID; facts carry it as ``source_id``.
        name: Display name.
        homepage: Where the provider describes the data (an app path for our own pages).
        license: SPDX identifier, or the provider's own terms name when there is none.
        license_url: Where the license or terms are stated.
        tier: What the license allows.
        status: Whether code reads from it yet.
        kind: How we obtain it.
        feeds: The SongNexus features that use it, in plain words.
        attribution: Text shown wherever its data appears ("" when not required).
        checked_on: ISO date the license was last checked against ``license_url``.
        notes: Caveats a reviewer must know (coverage, freshness, conditions).
    """

    id: str
    name: str
    homepage: str
    license: str
    license_url: str
    tier: Tier
    status: Status
    kind: Kind
    feeds: tuple[str, ...]
    attribution: str
    checked_on: str
    notes: str = ""


SOURCES: tuple[DataSource, ...] = (
    # --- Catalog: facts about artists, recordings and their credits -------------------------
    DataSource(
        id="musicbrainz",
        name="MusicBrainz",
        homepage="https://musicbrainz.org",
        license="CC0-1.0",
        license_url="https://musicbrainz.org/doc/About/Data_License",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=(
            "artists, recordings, releases and labels",
            "credits and artist relationships (every connection)",
            "collaborations, six degrees, compare, the daily puzzle",
            "concerts and festivals: artists who shared a bill",
        ),
        attribution="Data from MusicBrainz",
        checked_on="2026-10-07",
        notes="Core data only. Fetched at no more than one request per 1.1 s with an identifying "
        "User-Agent, as MusicBrainz asks.",
    ),
    DataSource(
        id="musicbrainz-supplementary",
        name="MusicBrainz genres",
        homepage="https://musicbrainz.org/doc/Genre",
        license="CC-BY-NC-SA-3.0",
        license_url="https://musicbrainz.org/doc/About/Data_License",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=("artist genres", "genre filters and shared genres in compare"),
        attribution="Genre data from MusicBrainz (CC BY-NC-SA 3.0)",
        checked_on="2026-10-07",
        notes="Tag-derived genre associations. Kept apart from core data; replaced by "
        "Discogs and Wikidata genres for commercial use.",
    ),
    DataSource(
        id="discogs",
        name="Discogs data dumps",
        homepage="https://data.discogs.com",
        license="CC0-1.0",
        license_url="https://support.discogs.com/hc/en-us/articles/360009334593",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.DATA_DUMP,
        feeds=(
            "artist genres (commercial-safe)",
            "genre filters and shared genres in compare",
            "artist comparisons: more credits (people credited on both artists' releases)",
        ),
        attribution="Data from Discogs",
        checked_on="2026-11-22",
        notes="Monthly XML dumps of artists, labels, masters and releases are CC0; we read the "
        "masters dump (main artists, genres, styles). API-only 'Restricted Data' (images, "
        "marketplace) is not used. Artists are joined through MusicBrainz and Wikidata links, "
        "never by name; styles map onto the MusicBrainz genre list by name or a reviewed table. "
        "Artist comparisons also read release credits (in the CC0 releases data) live from the "
        "Discogs API, within its rate limit, cached in memory for a day and never stored.",
    ),
    DataSource(
        id="genius",
        name="Genius API",
        homepage="https://genius.com",
        license="Genius API Terms of Service",
        license_url="https://genius.com/static/terms",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=("artist comparisons: more credits (producers, writers and features on both)",),
        attribution="Credits from Genius",
        checked_on="2026-11-22",
        notes="Only with SONGNEXUS_GENIUS_ACCESS_TOKEN. Song credits of an artist's most popular "
        "songs, read live when two artists are compared, cached in memory for a day and never "
        "stored. The artist is the exact-name search hit, never a near match. Lyrics are never "
        "read.",
    ),
    DataSource(
        id="deezer",
        name="Deezer API",
        homepage="https://developers.deezer.com/api",
        license="Deezer API Terms of Use",
        license_url="https://developers.deezer.com/termsofuse",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=(
            "artist pages: which song the 'Top song' shortcut opens",
            "shared Deezer links: which artist or playlist a pasted link names",
        ),
        attribution="Song ranking from Deezer",
        checked_on="2026-11-23",
        notes="Public endpoints, no key. For the Top song shortcut, the artist is the Deezer "
        "artist named exactly as ours (most fans if several share the name) and their top "
        "tracks are matched to the artist's own songs in our catalog by title; Deezer only "
        "picks which song, and no Deezer numbers (fans, ranks, plays) are shown or stored. "
        "Answers are cached in memory for a day. Non-commercial use under Deezer's terms.",
    ),
    DataSource(
        id="lastfm-api",
        name="Last.fm API",
        homepage="https://www.last.fm/api",
        license="Last.fm API Terms of Service",
        license_url="https://www.last.fm/api/tos",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=(
            "artist comparisons: Last.fm listeners and plays, and artists Last.fm lists as "
            "similar to both",
        ),
        attribution="Listening data from Last.fm",
        checked_on="2026-11-23",
        notes="Only with SONGNEXUS_LASTFM_API_KEY (free). Artists are looked up by MusicBrainz "
        "ID, never by name; read live when two artists are compared, cached in memory for an "
        "hour and never stored. Counts are Last.fm's own community, not all listeners, and "
        "'similar' is listener behaviour, never a collaboration. Non-commercial use only under "
        "the Last.fm API terms.",
    ),
    DataSource(
        id="wikidata",
        name="Wikidata",
        homepage="https://www.wikidata.org",
        license="CC0-1.0",
        license_url="https://www.wikidata.org/wiki/Wikidata:Licensing",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=(
            "genre hierarchy (subgenres)",
            "links from MusicBrainz artists to Discogs",
            "Around you: the campuses and cities listeners can join",
            "artist photos: which Commons file shows an artist",
            "artist pages and comparisons: descriptions, awards and nominations",
        ),
        attribution="Data from Wikidata",
        checked_on="2026-11-16",
        notes="Structured data is CC0. Used for 'subclass of' (P279) links between items carrying "
        "MusicBrainz genre IDs (P8052), and for items carrying both a MusicBrainz artist ID "
        "(P434) and a Discogs artist ID (P1953). The Around you list is the largest US "
        "universities by student count (P2196) plus a few abroad, their cities, US cities over "
        "100,000 people and national capitals, rebuilt with `songnexus fetch-communities`.",
    ),
    DataSource(
        id="wikipedia",
        name="Wikipedia (English)",
        homepage="https://en.wikipedia.org",
        license="CC-BY-SA-4.0",
        license_url="https://en.wikipedia.org/wiki/Wikipedia:Copyrights",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=("artist pages: a short introduction to the artist",),
        attribution="From Wikipedia (CC BY-SA 4.0)",
        checked_on="2026-11-22",
        notes="The plain-text introduction (a few sentences) of the article linked from the "
        "artist's Wikidata item, fetched with `songnexus fetch-facts`. CC BY-SA 4.0 allows reuse "
        "with attribution: the text is always shown with a link to the article and the license, "
        "and is shown as written, never edited.",
    ),
    DataSource(
        id="wikimedia-pageviews",
        name="Wikimedia pageviews",
        homepage="https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/",
        license="CC0-1.0",
        license_url="https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=("artist pages: how many people read about the artist on Wikipedia each month",),
        attribution="Pageviews from Wikimedia",
        checked_on="2026-11-23",
        notes="The average monthly human (user-agent) views of the artist's English Wikipedia "
        "article over the last 12 complete months, fetched with `songnexus fetch-facts`. Bots "
        "and crawlers are excluded by the API; a missing or new article has no figure.",
    ),
    DataSource(
        id="cover-art-archive",
        name="Cover Art Archive",
        homepage="https://coverartarchive.org",
        license="Images stay their rights holders'; the archive's data is CC0",
        license_url="https://musicbrainz.org/doc/Cover_Art_Archive/API",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=("song pages and song comparisons: album covers",),
        attribution="Cover art from the Cover Art Archive",
        checked_on="2026-11-23",
        notes="Front covers of the catalog's release groups, found by MusicBrainz ID with "
        "`songnexus fetch-covers` and hot-linked from the archive (Internet Archive hosting), "
        "never copied. Cover images are usually copyrighted artwork, shown as the archive "
        "permits for identifying a release; a commercial launch would review that use.",
    ),
    DataSource(
        id="billboard-hot-100",
        name="Billboard Hot 100 history (utdata/rwd-billboard-data)",
        homepage="https://github.com/utdata/rwd-billboard-data",
        license="Charts are Billboard's; archived for teaching by UT Austin (code MIT)",
        license_url="https://www.billboard.com/charts/hot-100/",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.DATASET,
        feeds=(
            "artist pages: Hot 100 entries, top tens and number ones",
            "song pages: peak position and weeks on the chart",
        ),
        attribution="Chart data: Billboard Hot 100",
        checked_on="2026-11-23",
        notes="Every weekly Hot 100 since August 1958, archived from billboard.com and updated "
        "weekly by UT Austin's data-journalism course (also on Kaggle as dhruvildave's "
        "billboard-the-hot-100-songs, which stops in 2021). Downloaded by `songnexus "
        "fetch-billboard` into the raw cache, never committed; only per-song summaries are "
        "stored. Songs and lead performers are matched to the catalog by exact names, never "
        "guessed. Non-commercial use only.",
    ),
    DataSource(
        id="billboard-200",
        name="Billboard 200 history (utdata/rwd-billboard-data)",
        homepage="https://github.com/utdata/rwd-billboard-data",
        license="Charts are Billboard's; archived for teaching by UT Austin (code MIT)",
        license_url="https://www.billboard.com/charts/billboard-200/",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.DATASET,
        feeds=("artist pages: Billboard 200 albums, top tens, number ones and their longest runs",),
        attribution="Chart data: Billboard 200",
        checked_on="2026-11-23",
        notes="Every weekly Billboard 200 album chart since 1967, from the same UT Austin archive "
        "as the Hot 100 (also on Kaggle in older copies). Downloaded by `songnexus "
        "fetch-billboard` into the raw cache, never committed; only per-album summaries (peak, "
        "weeks, first and last week) are stored, for albums whose lead performer matches one "
        "catalog artist by exact name. Non-commercial use only.",
    ),
    DataSource(
        id="rolling-stone-500",
        name="Rolling Stone's 500 Greatest Albums (The Pudding, via TidyTuesday)",
        homepage="https://pudding.cool/2024/03/greatest-music/",
        license="The ranking is Rolling Stone's; compiled by The Pudding, republished by "
        "TidyTuesday (CC0)",
        license_url="https://github.com/rfordatascience/tidytuesday/tree/main/data/2024/2024-05-07",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.DATASET,
        feeds=("artist pages: their albums on the list and their rank in each edition",),
        attribution="Rolling Stone, 500 Greatest Albums of All Time (2003, 2012, 2020); "
        "compiled by The Pudding",
        checked_on="2026-11-23",
        notes='The three editions of the list as The Pudding compiled them for "What makes an '
        "album the greatest of all time?\" (2024), read from TidyTuesday's copy by `songnexus "
        "fetch-greatest-albums`. Only the artist, album title, release year and the three ranks "
        "are read; the file's Spotify popularity and links are never read. Artists are matched "
        "to the catalog by their whole name. The ranking is Rolling Stone's editorial work, so "
        "it is credited and kept to non-commercial use.",
    ),
    DataSource(
        id="eurovision",
        name="Eurovision Song Contest Dataset (Spijkervet and Burgoyne)",
        homepage="https://github.com/Spijkervet/eurovision-dataset",
        license="CC-BY-4.0",
        license_url="https://zenodo.org/records/10088892",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.DATASET,
        feeds=("artist pages: Eurovision entries with the country, song, place and points",),
        attribution="Eurovision Song Contest Dataset, J. Spijkervet and J. A. Burgoyne (CC BY 4.0)",
        checked_on="2026-11-23",
        notes="Contestants of every contest from 1956 to 2023 (the 2023 release; compiled from "
        "EurovisionWorld), read by `songnexus fetch-eurovision`. The file also carries each "
        "song's lyrics: they are dropped by the parser and never stored or shown. Performers "
        "are matched to the catalog by their whole name only, so a duo is never credited to "
        "one of its members.",
    ),
    DataSource(
        id="wikimedia-commons",
        name="Wikimedia Commons",
        homepage="https://commons.wikimedia.org",
        license="Per file: public domain, CC0, CC BY or CC BY-SA",
        license_url="https://commons.wikimedia.org/wiki/Commons:Licensing",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=(
            "artist photos",
            "Around you: campus athletics marks, logos and seals",
            "the ListenBrainz and Libre.fm logos in connected services",
        ),
        attribution="Each photo and logo is credited with its author, license and file page",
        checked_on="2026-11-16",
        notes="Found through the image (P18) on the artist's Wikidata item, matched by MusicBrainz "
        "ID (P434); fetched with `songnexus fetch-images`. Each file carries its own "
        "license: only public domain, CC0, CC BY and CC BY-SA raster images are kept; non-free, "
        "unlicensed and non-commercial files are skipped. Images are hot-linked from Wikimedia's "
        "media hosts (upload.wikimedia.org, thumb.wikimedia.org), never copied, and the API "
        "returns the author, license and file page with every photo. Campus marks are the current "
        "logo (P154, no end date) of the athletics program that represents (P1268) the campus, "
        "else the campus's small logo (P8972), logo (P154) or seal (P158), SVG or PNG under the "
        "same license rule, chosen and hot-linked by `web/scripts/fetch-campus-logos.mjs` into "
        "`web/src/community/campusLogos.json`; the "
        "campus page links each logo's Commons file. The ListenBrainz (CC BY-SA 4.0, MetaBrainz "
        "Foundation) and Libre.fm (CC BY-SA 3.0) logo files are served unmodified from "
        "`web/public/brands`.",
    ),
    DataSource(
        id="simple-icons",
        name="Simple Icons",
        homepage="https://simpleicons.org",
        license="CC0-1.0 (the icons stay their brands' trademarks)",
        license_url="https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.DATA_DUMP,
        feeds=(
            "the YouTube Music, Spotify, Apple Music, Last.fm and Deezer marks in connected "
            "services, the import guide and every 'Listen on YouTube Music' button",
        ),
        attribution="",
        checked_on="2026-11-17",
        notes="SVG paths from simple-icons 16.38 copied into `web/src/components/BrandMark.tsx` "
        "with each brand's published color. The paths are CC0, but the marks are trademarks: they "
        "are used only to name the service a listener links or listens on, as the brands' "
        "guidelines allow, never altered or combined with the SongNexus mark (see the Simple "
        "Icons disclaimer).",
    ),
    # --- Audio descriptors and listening -------------------------------------------------
    DataSource(
        id="acousticbrainz",
        name="AcousticBrainz",
        homepage="https://acousticbrainz.org",
        license="CC0-1.0",
        license_url="https://acousticbrainz.org/download",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=("song comparison: tempo, key, loudness, mood and other audio descriptors",),
        attribution="Audio data from AcousticBrainz",
        checked_on="2026-11-01",
        notes="Data collection stopped in 2022; the API still serves the final dataset. Coverage "
        "is partial and keyed by MusicBrainz recording ID; songs without data say so. The "
        "voice-gender and genre classifiers are not used.",
    ),
    DataSource(
        id="listenbrainz",
        name="ListenBrainz",
        homepage="https://listenbrainz.org",
        license="CC0-1.0",
        license_url="https://listenbrainz.org/terms-of-service/",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.API,
        feeds=(
            "listener overlap in artist comparison",
            "'often played with' on artist pages",
            "the Connection Web's similar-music maps: similar artists and songs around an artist, "
            "a song or a playlist, and two friends' playlists on one map",
        ),
        attribution="Listening data from ListenBrainz",
        checked_on="2026-11-23",
        notes="Public listens are CC0. Only aggregates are fetched: listener and listen counts per "
        "artist, and the session-based similar-artists ranking. Overlap is shown only when both "
        "artists have at least 50 listeners, always with the counts. Similar songs (the Labs "
        "session-based similar recordings) are read live for the maps and cached in memory for a "
        "day, never stored; songs outside the catalog link to MusicBrainz.",
    ),
    # --- Sound & lyrics analysis (the song_compare service) ----------------------------------
    DataSource(
        id="kaggle-spotify-tracks",
        name="Spotify Tracks Dataset (maharshipandya)",
        homepage="https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset",
        license="As stated by the uploader (BSD on Hugging Face, CC0 on Kaggle)",
        license_url="https://huggingface.co/datasets/maharshipandya/spotify-tracks-dataset",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.SERVICE,
        feeds=(
            "song comparison: sound profile (energy, danceability, positivity and more), "
            "tempo, key and songs that sound alike, from the song_compare service",
        ),
        attribution="Sound analysis from the Spotify Tracks Dataset",
        checked_on="2026-11-22",
        notes="About 114,000 tracks across 125 genres with audio features, a 2022 snapshot; "
        "song_compare keeps about 76,000 of them. The uploader states a license, but the values "
        "come from the Spotify Web API, whose terms the uploader cannot waive: non-commercial use "
        "only, dropped by source ID for a commercial launch. Songs are matched to the dataset by "
        "title and primary artist; songs outside it say so. Nothing is stored in the catalog.",
    ),
    DataSource(
        id="genius-lyrics-dataset",
        name="Genius lyrics (Hugging Face, theelderemo)",
        homepage="https://huggingface.co/datasets/theelderemo/genius-lyrics-cleaned",
        license="As stated by the uploader; the lyrics stay their rights holders'",
        license_url="https://huggingface.co/datasets/theelderemo/genius-lyrics-cleaned",
        tier=Tier.NON_COMMERCIAL,
        status=Status.IN_USE,
        kind=Kind.SERVICE,
        feeds=("song comparison: lyric mood, themes and structure, from the song_compare service",),
        attribution="Lyric analysis from Genius lyrics",
        checked_on="2026-11-22",
        notes="song_compare analyzes the lyrics into sentiment, emotions, themes and structure "
        "counts. The lyrics themselves are never stored in this repository, sent to the app or "
        "shown.",
    ),
    # --- Offline evaluation only ---------------------------------------------------------
    DataSource(
        id="lastfm-360k",
        name="Last.fm 360K and 1K users (Celma, 2010)",
        homepage="https://zenodo.org/records/6090214",
        license="Non-commercial research use, with permission of Last.fm",
        license_url="https://zenodo.org/records/6090214",
        tier=Tier.EVALUATION,
        status=Status.IN_USE,
        kind=Kind.DATASET,
        feeds=("evaluating listener overlap against an independent population",),
        attribution="Last.fm dataset, Ò. Celma (2010)",
        checked_on="2026-11-01",
        notes="Per-user artist play counts with MusicBrainz artist IDs; collected 2008-2009, so it "
        "measures agreement, not current overlap. Also mirrored on Kaggle.",
    ),
    # --- A listener's own data -----------------------------------------------------------
    DataSource(
        id="user-listening",
        name="Your listening history",
        homepage="/privacy",
        license="The listener's own data",
        license_url="/privacy",
        tier=Tier.PRODUCTION,
        status=Status.IN_USE,
        kind=Kind.USER_ACCOUNT,
        feeds=(
            "Library: your artists and playlist analysis",
            "Around you: campus and city charts, from listeners who opt in",
        ),
        attribution="",
        checked_on="2026-10-07",
        notes="Imported files are parsed on the device; only artist names reach the server. Linked "
        "accounts add each provider under its own API terms. Around you charts use only "
        "members who opted in, and only once 10 have listening data; an artist needs 3 listeners "
        "and counts are shown as ranges.",
    ),
)

BY_ID: dict[str, DataSource] = {s.id: s for s in SOURCES}

# Sources that may assert artist-genre associations.
GENRE_SOURCE_IDS = ("musicbrainz-supplementary", "discogs")


def catalog_sources() -> tuple[DataSource, ...]:
    """Returns the sources whose facts may be stored in the catalog.

    That excludes evaluation-only datasets, listeners' own data and analysis served live by a
    companion service.
    """
    return tuple(
        s
        for s in SOURCES
        if s.tier is not Tier.EVALUATION and s.kind not in (Kind.USER_ACCOUNT, Kind.SERVICE)
    )


_TIER_TEXT = {
    Tier.PRODUCTION: "Usable in a commercial product",
    Tier.NON_COMMERCIAL: "Non-commercial use (dropped by ID for a commercial launch)",
    Tier.EVALUATION: "Offline evaluation only; never stored or shown",
}


def render_markdown() -> str:
    """The data-source reference (``docs/data-sources.md``), generated from ``SOURCES``."""
    lines = [
        "# Data sources",
        "",
        "Every source SongNexus reads, with its license and what it feeds. Generated from",
        "`server/src/songnexus/catalog/sources.py` by `songnexus sources`; edit the registry,",
        "not this file (CI checks they match). The API serves the same list at",
        "`GET /v1/dataSources`.",
        "",
        "| Source | License | Use | How it is read | What it feeds |",
        "| --- | --- | --- | --- | --- |",
    ]
    for s in SOURCES:
        feeds = "; ".join(s.feeds)
        link = f"[{s.name}]({s.homepage})" if s.homepage.startswith("https://") else s.name
        license_ = (
            f"[{s.license}]({s.license_url})" if s.license_url.startswith("https://") else s.license
        )
        kind = s.kind.value.replace("_", " ").lower()
        lines.append(f"| {link} | {license_} | {_TIER_TEXT[s.tier]} | {kind} | {feeds} |")
    lines += ["", "## Notes", ""]
    for s in SOURCES:
        if s.notes:
            lines += [f"**{s.name}** (checked {s.checked_on}). {s.notes}", ""]
    return "\n".join(lines).rstrip()
