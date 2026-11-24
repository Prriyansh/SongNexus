"""Rolling Stone's 500 Greatest Albums of All Time (``songnexus fetch-greatest-albums``).

The 2003, 2012 and 2020 editions of the list, as The Pudding compiled them for "What makes an
album the greatest of all time?" (2024) and TidyTuesday republished them (2024-05-07). The
ranking is Rolling Stone's editorial work, so only an album's ranks, title and release year are
kept, credited to Rolling Stone; the file's other columns (Spotify popularity and links, Billboard
weeks, the compilers' derived fields) are never read. Matching to the catalog happens in
``service.lists_job``.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path

ROLLING_STONE_URL = (
    "https://raw.githubusercontent.com/rfordatascience/tidytuesday/main/"
    "data/2024/2024-05-07/rolling_stone.csv"
)
EDITIONS = (2003, 2012, 2020)


@dataclass(frozen=True)
class ListedAlbum:
    """One album on the list, with its rank in each edition (None when it wasn't on it)."""

    artist: str
    title: str
    release_year: int | None
    rank_2003: int | None
    rank_2012: int | None
    rank_2020: int | None


def _number(value: str | None) -> int | None:
    try:
        return int(value) if value and value.strip() not in {"", "NA"} else None
    except ValueError:
        return None


def parse_albums(text: str) -> list[ListedAlbum]:
    """The albums ranked in at least one edition, in the file's order."""
    albums: list[ListedAlbum] = []
    for row in csv.DictReader(io.StringIO(text)):
        artist, title = (row.get("clean_name") or "").strip(), (row.get("album") or "").strip()
        ranks = [_number(row.get(f"rank_{year}")) for year in EDITIONS]
        if not artist or not title or all(r is None for r in ranks):
            continue
        albums.append(
            ListedAlbum(
                artist, title, _number(row.get("release_year")), ranks[0], ranks[1], ranks[2]
            )
        )
    return albums


def read_albums(path: Path) -> list[ListedAlbum]:
    """The albums in a downloaded file."""
    return parse_albums(path.read_text(encoding="utf-8"))
