import json

import pandas as pd

import prepare_data as prep


def test_norm_text_strips_features_versions_and_accents():
    assert prep.norm_text("Unholy (feat. Kim Petras)") == "unholy"
    assert prep.norm_text("Time - Remastered 2011") == "time"
    assert prep.norm_text("Tití Me Preguntó") == "titi me pregunto"
    assert prep.norm_text(None) == ""


def test_artist_variants_split_joint_credits():
    assert set(prep.artist_variants("Sam Smith & Kim Petras")) == {"sam smith kim petras", "sam smith", "kim petras"}
    assert prep.artist_variants(None) == []


def test_match_lyrics_matches_title_and_any_credited_artist():
    spotify = pd.DataFrame({"title_n": ["unholy", "other song"], "match_key": ["unholy|sam smith", "other song|someone"]})
    genius = pd.DataFrame({
        "title": ["Unholy", "Unholy", "Nope"],
        "artist": ["Sam Smith & Kim Petras", "Sam Smith", "Someone"],
        "lyrics": ["short", "a longer version of the lyrics", "x"],
    })
    found = prep.match_lyrics(spotify, iter([genius]))
    assert list(found) == [0]
    assert found[0][0] == "a longer version of the lyrics"  # keeps the longest copy


def test_prepare_writes_parquet_and_json_not_pickle(demo_dir):
    names = {p.name for p in demo_dir.iterdir()}
    assert {"tracks.parquet", "audio_bounds.json", "match_report.json", "tfidf.npz", "lsa.npy"} <= names
    assert not any(n.endswith((".pkl", ".joblib")) for n in names)
    report = json.loads((demo_dir / "match_report.json").read_text())
    assert 0 < report["match_rate"] <= 1
    assert report["matched_with_lyrics"] <= report["spotify_unique_songs"]


def test_prepare_never_stores_lyric_text(demo_dir):
    tracks = pd.read_parquet(demo_dir / "tracks.parquet")
    assert "lyrics" not in tracks.columns
    stored = " ".join(tracks["lyrics_analysis"].dropna())
    assert "whole world slows" not in stored  # a line from the demo lyrics
