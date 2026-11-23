"""Billboard Hot 100 history (``songnexus fetch-billboard``): every weekly chart since August 1958.

The weekly charts come from the University of Texas data-journalism archive of billboard.com
(``utdata/rwd-billboard-data``, updated weekly; the Kaggle copy stops in 2021). Billboard owns
the charts, so the file is downloaded into the git-ignored raw cache, never committed, and only
per-song summaries reach the database: peak position, weeks on the chart and the first and last
chart weeks. Matching songs to the catalog happens in ``service.billboard_job``.
"""

from __future__ import annotations

import csv
import io
import logging
import re
import time
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx

from songnexus.catalog.wikidata.images import USER_AGENT

log = logging.getLogger(__name__)

HOT_100_URL = (
    "https://raw.githubusercontent.com/utdata/rwd-billboard-data/main/data-out/hot-100-current.csv"
)
REFRESH_AFTER_S = 6 * 24 * 3600  # the archive updates weekly
# Words that join a lead performer to others ("Lil Durk Featuring Morgan Wallen").
_FEATURING = re.compile(r"\s+(?:featuring|feat\.?|ft\.?|with|duet with)\s+", re.IGNORECASE)
_LIST = re.compile(r"\s*(?:,|&|\bx\b|\band\b|/)\s*", re.IGNORECASE)


@dataclass(frozen=True)
class ChartSong:
    """One song's run on the Hot 100."""

    title: str
    performer: str
    peak: int
    weeks: int
    first_week: date
    last_week: date


def download(raw_dir: Path, *, url: str = HOT_100_URL, http: httpx.Client | None = None) -> Path:
    """The weekly charts as a local CSV, downloaded again when the copy is a week old."""
    target = raw_dir / "hot-100-current.csv"
    if target.exists() and time.time() - target.stat().st_mtime < REFRESH_AFTER_S:
        return target
    raw_dir.mkdir(parents=True, exist_ok=True)
    client = http or httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0))
    with client:
        response = client.get(url, headers={"User-Agent": USER_AGENT})
        response.raise_for_status()
    partial = target.with_suffix(".partial")
    partial.write_bytes(response.content)
    partial.replace(target)
    return target


def parse_weeks(text: str) -> list[ChartSong]:
    """Per-song summaries from the weekly rows (one row per song per week)."""
    songs: dict[tuple[str, str], ChartSong] = {}
    for row in csv.DictReader(io.StringIO(text)):
        try:
            week = date.fromisoformat(row["chart_week"])
            position = int(row["current_week"])
            weeks = int(row["wks_on_chart"])
        except (KeyError, ValueError):
            continue
        title, performer = row.get("title", "").strip(), row.get("performer", "").strip()
        if not title or not performer:
            continue
        key = (title, performer)
        seen = songs.get(key)
        songs[key] = ChartSong(
            title=title,
            performer=performer,
            peak=min(position, seen.peak) if seen else position,
            weeks=max(weeks, seen.weeks) if seen else weeks,
            first_week=min(week, seen.first_week) if seen else week,
            last_week=max(week, seen.last_week) if seen else week,
        )
    return sorted(songs.values(), key=lambda s: (s.first_week, s.title, s.performer))


def performer_candidates(performer: str) -> list[str]:
    """Names to try for the lead artist, most specific first.

    The whole credit first (so a duo named "Simon & Garfunkel" stays one artist), then the part
    before "Featuring"/"With", then the first name of a list ("A & B", "A, B", "A x B").
    """
    out = [performer]
    lead = _FEATURING.split(performer, maxsplit=1)[0].strip()
    out.append(lead)
    out.append(_LIST.split(lead, maxsplit=1)[0].strip())
    return [name for name in dict.fromkeys(out) if name]


def read_chart_songs(path: Path) -> list[ChartSong]:
    """The per-song summaries in a downloaded file."""
    return parse_weeks(path.read_text(encoding="utf-8"))


def top_songs(songs: Iterable[ChartSong], limit: int) -> list[ChartSong]:
    """The longest-charting songs first (best peak, then most weeks), for a quick sample."""
    return sorted(songs, key=lambda s: (s.peak, -s.weeks, s.first_week))[:limit]
