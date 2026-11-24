"""Conversions from core and storage objects to API schemas."""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from songnexus.core.graph import collaborations as collab
from songnexus.core.graph.explain import Explanation
from songnexus.core.graph.model import ArtistGraph, Category, EdgeKind, SubjectType
from songnexus.service import schemas as api
from songnexus.storage import album_lists, charts, events
from songnexus.storage.artist_facts import FactsRecord, Honor
from songnexus.storage.catalog_repository import SourceRef

_SUBJECT_COLLECTIONS = {
    SubjectType.RECORDING: "recordings",
    SubjectType.RELEASE: "releases",
    SubjectType.RELATION: "relations",
    SubjectType.LABEL: "labels",
}


def artist_summary(graph: ArtistGraph, artist_id: str) -> api.ArtistSummary:
    """Returns the list form of an artist."""
    node = graph.nodes[artist_id]
    return api.ArtistSummary(
        name=f"artists/{node.id}",
        display_name=node.name,
        disambiguation=node.disambiguation,
        artist_type=node.artist_type,
        country=node.country,
        genre_known=bool(node.genres),
        image_url=image_url(graph, artist_id),
        listeners=graph.listeners.get(artist_id),
    )


def image_url(graph: ArtistGraph, artist_id: str) -> str | None:
    """Returns the ~330 px photo URL of an artist, or None (no photo, or not an artist)."""
    image = graph.images.get(artist_id)
    return image.thumbnail_url if image else None


def artist_image(graph: ArtistGraph, artist_id: str) -> api.ArtistImage | None:
    """Returns an artist's photo with its attribution, or None."""
    image = graph.images.get(artist_id)
    if image is None:
        return None
    return api.ArtistImage(
        url=image.url,
        thumbnail_url=image.thumbnail_url,
        width=image.width,
        height=image.height,
        page_url=image.page_url,
        author=image.author,
        license=image.license,
        license_url=image.license_url,
    )


def kind(edge_kind: EdgeKind) -> api.ConnectionKind:
    """Returns the API enum for an edge kind."""
    return api.ConnectionKind(edge_kind.value.upper())


def kinds_list(kinds: Iterable[EdgeKind]) -> list[api.ConnectionKind]:
    """Returns API kinds in a stable order."""
    order = list(EdgeKind)
    return [kind(k) for k in sorted(set(kinds), key=order.index)]


def category(value: api.ConnectionCategory) -> Category:
    """Returns the core category for an API category."""
    return Category(value.value.lower())


def collaboration_type(value: api.CollaborationType) -> collab.CollaborationType:
    """Returns the core collaboration type for an API one."""
    return collab.CollaborationType(value.value)


def source_links(refs: Iterable[SourceRef]) -> list[api.SourceLink]:
    """Returns API source links."""
    return [api.SourceLink(source=r.source, source_id=r.source_id, url=r.url) for r in refs]


def evidence(
    explanation: Explanation, sources: Mapping[str, list[SourceRef]] | None = None
) -> api.Evidence:
    """Returns an API evidence line, with sources when supplied."""
    collection = _SUBJECT_COLLECTIONS[explanation.subject_type]
    return api.Evidence(
        message_id=explanation.message_id.value,
        kind=kind(explanation.kind),
        from_artist=f"artists/{explanation.from_artist}",
        to_artist=f"artists/{explanation.to_artist}",
        from_role=explanation.from_role,
        to_role=explanation.to_role,
        subject=api.Subject(
            name=f"{collection}/{explanation.subject_id}",
            display_name=explanation.subject_title,
        ),
        sources=source_links((sources or {}).get(explanation.subject_id, [])),
    )


def subject_keys(explanations: Iterable[Explanation]) -> list[tuple[str, str]]:
    """Returns (subject type, subject ID) pairs for a source lookup."""
    return sorted({(e.subject_type.value, e.subject_id) for e in explanations})


def _honor(honor: Honor) -> api.Honor:
    return api.Honor(
        display_name=honor.name, year=honor.year, url=f"https://www.wikidata.org/wiki/{honor.id}"
    )


def artist_about(facts: FactsRecord | None) -> api.ArtistAbout | None:
    """Returns an artist's reference facts, or None when there are none."""
    if facts is None or facts.is_empty:
        return None
    return api.ArtistAbout(
        description=facts.description,
        # Wikipedia text is shown only with its article link (CC BY-SA 4.0).
        summary=facts.summary if facts.wikipedia_url else None,
        wikipedia_url=facts.wikipedia_url,
        wikidata_url=f"https://www.wikidata.org/wiki/{facts.wikidata_id}",
        awards=[_honor(h) for h in facts.awards],
        nominations=[_honor(h) for h in facts.nominations],
        monthly_wikipedia_views=facts.monthly_views,
    )


def shared_awards(a: FactsRecord | None, b: FactsRecord | None) -> list[api.Honor]:
    """Awards both artists received (the same award, any year), once each, newest first.

    Each keeps the first artist's most recent year for it.
    """
    if a is None or b is None:
        return []
    theirs = {h.id for h in b.awards}
    seen: set[str] = set()
    shared: list[api.Honor] = []
    for honor in a.awards:  # already newest first
        if honor.id in theirs and honor.id not in seen:
            seen.add(honor.id)
            shared.append(_honor(honor))
    return shared


def artist_charts(chart: charts.ArtistChart | None) -> api.ArtistCharts | None:
    """An artist's Hot 100 history, or None."""
    if chart is None:
        return None
    return api.ArtistCharts(
        entries=chart.entries,
        top_ten=chart.top_ten,
        number_ones=chart.number_ones,
        best_peak=chart.best_peak,
        first_year=chart.first_week.year,
        last_year=chart.last_week.year,
    )


TOP_ALBUMS = 6
TOP_TEN = 10


def album_charts(runs: list[album_lists.AlbumRun]) -> api.AlbumCharts | None:
    """An artist's Billboard 200 history from their runs (best first), or None."""
    if not runs:
        return None
    return api.AlbumCharts(
        entries=len(runs),
        top_ten=sum(r.peak <= TOP_TEN for r in runs),
        number_ones=sum(r.peak == 1 for r in runs),
        best_peak=min(r.peak for r in runs),
        first_year=min(r.first_week for r in runs).year,
        last_year=max(r.last_week for r in runs).year,
        top_albums=[
            api.AlbumChartRun(
                title=r.title, peak=r.peak, weeks=r.weeks, first_year=r.first_week.year
            )
            for r in runs[:TOP_ALBUMS]
        ],
    )


def greatest_albums(albums: list[album_lists.ListedAlbum]) -> list[api.GreatestAlbum]:
    """An artist's albums on Rolling Stone's list."""
    return [
        api.GreatestAlbum(
            title=a.title,
            release_year=a.release_year,
            rank_2003=a.rank_2003,
            rank_2012=a.rank_2012,
            rank_2020=a.rank_2020,
        )
        for a in albums
    ]


def eurovision(entries: list[album_lists.ContestEntry]) -> list[api.EurovisionEntry]:
    """An artist's Eurovision entries."""
    return [
        api.EurovisionEntry(
            year=e.year,
            country=e.country,
            song=e.song,
            place_final=e.place_final,
            points_final=e.points_final,
            place_semi_final=e.place_semi_final,
        )
        for e in entries
    ]


def song_chart(chart: charts.SongChart | None) -> api.SongChart | None:
    """A song's Hot 100 run, or None."""
    if chart is None:
        return None
    return api.SongChart(
        peak=chart.peak,
        weeks=chart.weeks,
        first_week=chart.first_week.isoformat(),
        last_week=chart.last_week.isoformat(),
    )


def event_summary(graph: ArtistGraph, event: events.EventRecord) -> api.EventSummary:
    """An event with its catalog performers."""
    return api.EventSummary(
        display_name=event.name,
        kind=event.kind,
        date=event.date,
        place=event.place,
        url=f"https://musicbrainz.org/event/{event.id}",
        performers=[artist_summary(graph, a) for a in event.performers if a in graph.nodes],
    )
