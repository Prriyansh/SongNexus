"""Matches a dataset's artist credit to one catalog artist by name, strictly.

Chart, list and contest datasets name artists only by text, so a loose match would hand one
artist's history to a namesake ("Gemini", a Portuguese Eurovision band, is also a MusicBrainz
alias of Prince). The rules, in order:

- the whole credit equals one catalog artist's name, or a name MusicBrainz records as theirs
  (an ``artist_name`` or ``legal_name`` alias, such as "Kanye West" for Ye); loose aliases and
  search hints never count. A match through such a name is marked, because those names are
  shared more often ("Davy Jones" is an early name of David Bowie's and the Monkees' singer):
  callers then also need the song or album among the artist's catalog titles;
- otherwise, when splitting is allowed, the credit's lead ("A Featuring B", "A & B") equals one
  catalog artist's own name exactly, never an alias ("Big & Rich" is not "BIG").

A name that two catalog artists share matches neither.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Collection
from dataclasses import dataclass

from sqlalchemy import Engine, select

from songnexus.catalog.billboard import performer_candidates
from songnexus.core.text import normalize
from songnexus.storage import models as m
from songnexus.storage.db import session_scope

OWN_NAMES = ("artist_name", "legal_name")  # alias types that are the artist's own names


@dataclass(frozen=True)
class NameMatch:
    """The catalog artist a credit names; ``by_alias`` when only one of their other names fit."""

    artist_id: str
    by_alias: bool = False


class ArtistNames:
    """Catalog artists by normalized name and by their recorded own names."""

    def __init__(self, names: dict[str, set[str]], own_names: dict[str, set[str]]) -> None:
        self._names = names
        self._own_names = own_names
        self._cache: dict[tuple[str, bool], NameMatch | None] = {}

    @classmethod
    def load(cls, engine: Engine, artist_ids: Collection[str] | None = None) -> ArtistNames:
        """Reads the names; ``artist_ids`` limits them to the artists being served."""
        names: dict[str, set[str]] = defaultdict(set)
        own: dict[str, set[str]] = defaultdict(set)
        keep = set(artist_ids) if artist_ids is not None else None
        with session_scope(engine) as session:
            for artist_id, name in session.execute(select(m.Artist.id, m.Artist.name)):
                if keep is None or artist_id in keep:
                    names[normalize(name)].add(artist_id)
            aliases = select(m.ArtistAlias.artist_id, m.ArtistAlias.alias).where(
                m.ArtistAlias.alias_type.in_(OWN_NAMES)
            )
            for artist_id, alias in session.execute(aliases):
                if keep is None or artist_id in keep:
                    own[normalize(alias)].add(artist_id)
        return cls(dict(names), dict(own))

    def _one(self, key: str, *, aliases: bool) -> NameMatch | None:
        found = self._names.get(key, set())
        if len(found) == 1:
            return NameMatch(next(iter(found)))
        if aliases and not found:
            own = self._own_names.get(key, set())
            if len(own) == 1:
                return NameMatch(next(iter(own)), by_alias=True)
        return None

    def match(self, credit: str, *, split: bool = False) -> NameMatch | None:
        """The one catalog artist this credit names, or None."""
        cache_key = (credit, split)
        if cache_key not in self._cache:
            found = self._one(normalize(credit), aliases=True)
            if found is None and split:
                for lead in performer_candidates(credit)[1:]:
                    found = self._one(normalize(lead), aliases=False)
                    if found is not None:
                        break
            self._cache[cache_key] = found
        return self._cache[cache_key]
