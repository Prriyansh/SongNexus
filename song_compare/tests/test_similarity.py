import math

import similarity as sim


def track(key, mode, artists=("A",), album="X", genre="pop"):
    return {"key": key, "mode": mode, "artists": list(artists), "album": album, "genre": genre}


def test_closest_tempo_treats_half_and_double_time_as_equal():
    assert sim._closest_tempo(140, 70) == 140
    assert sim._closest_tempo(70, 140) == 70
    assert sim._closest_tempo(120, 118) == 118


def test_key_relation_uses_the_circle_of_fifths():
    assert sim.key_relation(track(0, 1), track(0, 1)) == "same key"
    assert sim.key_relation(track(0, 1), track(9, 0)) == "relative major/minor"  # C major, A minor
    assert sim.key_relation(track(0, 1), track(7, 1)) == "closely related key"  # C, G
    assert sim.key_relation(track(0, 1), track(6, 1)) == "6 steps apart on the circle of fifths"
    assert sim.key_relation(track(None, 1), track(0, 1)) == "unknown"


def test_shared_credits_compares_artists_case_insensitively():
    credits = sim.shared_credits(track(0, 1, ("Mira Vale", "Dex")), track(0, 1, ("mira vale",), album="Y"))
    assert credits["artists"] == ["Mira Vale"]
    assert not credits["same_album"] and credits["same_genre"]


def test_compare_scores_are_bounded_and_symmetric(catalog, lyric_ids):
    a, b = lyric_ids
    ab, ba = sim.compare(catalog, a, b), sim.compare(catalog, b, a)
    for result in (ab, ba):
        assert 0 <= result["overall"] <= 1 and 0 <= result["audio"]["score"] <= 1
        assert result["lyrics"] is not None and 0 <= result["lyrics"]["score"] <= 1
        assert 1 <= len(result["reasons"]) <= 6
    assert math.isclose(ab["audio"]["score"], ba["audio"]["score"], abs_tol=0.05)  # tempo folding is one-sided


def test_compare_with_itself_is_a_perfect_match(catalog, lyric_ids):
    result = sim.compare(catalog, lyric_ids[0], lyric_ids[0])
    assert result["audio"]["score"] == 1.0


def test_compare_falls_back_to_audio_without_lyrics(catalog, lyric_ids):
    t = catalog.tracks
    no_lyrics = t.loc[t.lyric_row < 0, "track_id"].iloc[0]
    result = sim.compare(catalog, lyric_ids[0], no_lyrics)
    assert result["lyrics"] is None
    assert result["overall"] == result["audio"]["score"]
    assert "audio only" in result["reasons"][-1]


def test_compare_unknown_id_returns_none(catalog, lyric_ids):
    assert sim.compare(catalog, lyric_ids[0], "nope") is None


def test_similar_tracks_excludes_the_seed_and_sorts_by_score(catalog, lyric_ids):
    results = sim.similar_tracks(catalog, lyric_ids[0], k=5)
    assert len(results) == 5
    assert lyric_ids[0] not in [r["id"] for r in results]
    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True)
