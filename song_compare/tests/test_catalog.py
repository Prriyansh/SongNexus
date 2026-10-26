import json

import pytest

from catalog import Catalog


def test_loads_tracks_and_lyric_features(catalog):
    assert len(catalog.tracks) > 300
    features = catalog.tracks.loc[catalog.tracks.lyric_row >= 0, "lyrics_analysis"].iloc[0]
    assert isinstance(features, dict) and "sentiment" in features


def test_scaled_audio_is_between_zero_and_one(catalog):
    assert catalog.audio.min() >= 0 and catalog.audio.max() <= 1
    assert catalog.median_dist > 0


def test_search_matches_every_term_ignoring_accents_and_case(catalog):
    title = catalog.tracks.track_name.iloc[0]
    results = catalog.search(title.upper(), limit=3)
    assert results and all(title.lower() in r["title"].lower() for r in results)
    assert catalog.search("zzzz not a song") == []


def test_detail_is_json_serialisable(catalog):
    json.dumps(catalog.detail(0))


def test_missing_data_raises_a_helpful_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="prepare_data.py"):
        Catalog(tmp_path)
