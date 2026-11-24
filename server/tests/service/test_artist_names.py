"""Strict name matching for chart, list and contest credits: never a namesake."""

from songnexus.core.text import normalize
from songnexus.service.artist_names import ArtistNames, NameMatch


def names() -> ArtistNames:
    def index(pairs: list[tuple[str, str]]) -> dict[str, set[str]]:
        out: dict[str, set[str]] = {}
        for name, artist in pairs:
            out.setdefault(normalize(name), set()).add(artist)
        return out

    return ArtistNames(
        index(
            [
                ("Ye", "ye"),
                ("The Notorious B.I.G.", "biggie"),
                ("Lil Durk", "durk"),
                ("Drake", "drake"),
                ("Nirvana", "nirvana-us"),
                ("Nirvana", "nirvana-uk"),  # two catalog artists share the name
            ]
        ),
        index([("Kanye West", "ye"), ("BIG", "biggie")]),  # their own recorded names
    )


def test_an_exact_name_matches() -> None:
    assert names().match("Drake") == NameMatch("drake")


def test_an_own_name_matches_but_is_marked() -> None:
    assert names().match("Kanye West") == NameMatch("ye", by_alias=True)


def test_a_shared_name_matches_neither() -> None:
    assert names().match("Nirvana") is None


def test_a_lead_counts_only_by_its_exact_name() -> None:
    assert names().match("Lil Durk Featuring Morgan Wallen", split=True) == NameMatch("durk")
    # "Big" is one of B.I.G.'s names, but a lead is never matched through an alias.
    assert names().match("Big & Rich", split=True) is None
    # Without splitting (lists, contests) a duo is never one of its members.
    assert names().match("Lil Durk & Friends") is None
