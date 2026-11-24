"""Eurovision Song Contest entries since 1956 (``songnexus fetch-eurovision``).

The contestants file of the Eurovision Song Contest Dataset (Spijkervet and Burgoyne, released
under CC BY 4.0 on Zenodo and as GitHub releases), compiled from EurovisionWorld. Each entry keeps
its year, country, performer, song and its places and points. The file also carries each song's
lyrics, which stay their writers' and are never read past the parser: no lyric is kept anywhere.
Matching performers to the catalog happens in ``service.lists_job``.
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from pathlib import Path

CONTESTANTS_URL = (
    "https://github.com/Spijkervet/eurovision-dataset/releases/download/2023/contestants.csv"
)
_FIELD_LIMIT = 1 << 24  # the lyrics column holds whole songs in one field


@dataclass(frozen=True)
class ContestEntry:
    """One country's entry in one year's contest."""

    year: int
    country: str
    performer: str
    song: str
    place_final: int | None = None  # None: didn't qualify for the final
    points_final: int | None = None
    place_semi_final: int | None = None


def _number(value: str | None) -> int | None:
    try:
        return int(float(value)) if value and value.strip() not in {"", "NA"} else None
    except ValueError:
        return None


def parse_entries(text: str) -> list[ContestEntry]:
    """The entries with a year, country, performer and song; the lyrics are dropped here."""
    csv.field_size_limit(_FIELD_LIMIT)
    entries: list[ContestEntry] = []
    for row in csv.DictReader(io.StringIO(text)):
        year = _number(row.get("year"))
        country = (row.get("to_country") or "").strip()
        performer = (row.get("performer") or "").strip()
        song = (row.get("song") or "").strip()
        if year is None or not country or not performer or not song:
            continue
        entries.append(
            ContestEntry(
                year=year,
                country=country,
                performer=performer,
                song=song,
                place_final=_number(row.get("place_final")),
                points_final=_number(row.get("points_final")),
                place_semi_final=_number(row.get("place_sf")),
            )
        )
    return entries


def read_entries(path: Path) -> list[ContestEntry]:
    """The entries in a downloaded file."""
    return parse_entries(path.read_text(encoding="utf-8"))
