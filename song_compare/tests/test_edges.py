"""
The paths the other tests don't take: data preparation from Hugging Face and Parquet, files
missing columns, lyrics too short to compare, the command line; the catalog without a match report;
sentiment without VADER; every kind of reason; similar songs with repeats; the Vercel entry point.
"""
import importlib
import sys
import types

import pandas as pd
import pytest

import nlp
import prepare_data as prep
import similarity as sim
from catalog import Catalog


# ---------------------------------------------------------------- data preparation
def test_load_spotify_refuses_a_file_missing_columns(tmp_path):
    path = tmp_path / "spotify.csv"
    pd.DataFrame({"track_id": ["a"], "artists": ["X"]}).to_csv(path, index=False)
    with pytest.raises(SystemExit, match="missing columns"):
        prep.load_spotify(path)


def test_iter_genius_streams_hugging_face_in_batches(monkeypatch):
    rows = [{"title": f"Song {i}", "artist": "X", "tag": "pop", "year": 2020, "lyrics": "la"} for i in range(5)]
    fake = types.ModuleType("datasets")
    fake.load_dataset = lambda *args, **kwargs: iter(rows)
    monkeypatch.setitem(sys.modules, "datasets", fake)
    batches = list(prep.iter_genius(hf=True, batch=2))
    assert [len(b) for b in batches] == [2, 2, 1]
    assert list(batches[0].columns) == ["title", "artist", "tag", "year", "lyrics"]


def test_iter_genius_streams_exactly_full_batches(monkeypatch):
    fake = types.ModuleType("datasets")
    fake.load_dataset = lambda *args, **kwargs: iter([{"title": "A"}, {"title": "B"}])
    monkeypatch.setitem(sys.modules, "datasets", fake)
    assert [len(b) for b in prep.iter_genius(hf=True, batch=2)] == [2]


def test_iter_genius_reads_parquet_keeping_only_known_columns(tmp_path):
    path = tmp_path / "genius.parquet"
    pd.DataFrame({"title": ["A"], "artist": ["X"], "lyrics": ["la"], "extra": [1]}).to_parquet(path)
    (batch,) = list(prep.iter_genius(path))
    assert list(batch.columns) == ["title", "artist", "lyrics"]


def test_match_lyrics_skips_rows_without_lyric_text():
    spotify = pd.DataFrame({"title_n": ["song"], "match_key": [prep.make_key("song", "x")]})
    genius = pd.DataFrame({"title": ["Song"], "artist": ["X"], "lyrics": [None]})
    assert prep.match_lyrics(spotify, [genius]) == {}


def test_prepare_leaves_out_lyrics_too_short_to_compare(tmp_path):
    raw = tmp_path / "raw"
    from make_demo_data import write_demo
    spotify_csv, genius_csv = write_demo(raw)
    genius = pd.read_csv(genius_csv)
    genius["lyrics"] = "too short"
    genius.to_csv(genius_csv, index=False)
    out = tmp_path / "processed"
    (out).mkdir()
    (out / "tfidf.npz").write_text("stale")
    (out / "lsa.npy").write_text("stale")
    report = prep.prepare(spotify_csv, genius_csv, out=out)
    assert report["matched_with_lyrics"] == 0
    assert not (out / "tfidf.npz").exists() and not (out / "lsa.npy").exists()  # none left from an earlier run


def test_main_needs_a_lyrics_source_and_passes_the_options_on(monkeypatch, capsys):
    calls = []
    monkeypatch.setattr(prep, "prepare", lambda *args: calls.append(args))
    monkeypatch.setattr(sys, "argv", ["prepare_data.py", "--spotify", "s.csv"])
    with pytest.raises(SystemExit):
        prep.main()
    assert "pass --genius PATH or --hf" in capsys.readouterr().err
    monkeypatch.setattr(sys, "argv", ["prepare_data.py", "--spotify", "s.csv", "--genius", "g.csv"])
    prep.main()
    assert calls == [("s.csv", "g.csv", False)]


# ---------------------------------------------------------------- catalog
def test_catalog_works_without_a_match_report(demo_dir, tmp_path):
    for f in demo_dir.iterdir():
        if f.name != "match_report.json":
            (tmp_path / f.name).write_bytes(f.read_bytes())
    assert Catalog(tmp_path).report == {}


def test_search_without_words_finds_nothing(catalog):
    assert catalog.search("  ...  ") == []


# ---------------------------------------------------------------- sentiment
def test_sentiment_without_vader_uses_the_built_in_words(monkeypatch):
    monkeypatch.setattr(nlp, "_vader", None)
    assert nlp._line_sentiment("love and joy") > 0
    assert nlp._line_sentiment("...") == 0.0


def test_a_missing_vader_falls_back_to_the_built_in_words(monkeypatch):
    monkeypatch.setitem(sys.modules, "vaderSentiment.vaderSentiment", None)  # importing it now fails
    try:
        assert importlib.reload(nlp)._vader is None
    finally:
        monkeypatch.delitem(sys.modules, "vaderSentiment.vaderSentiment")
        importlib.reload(nlp)


# ---------------------------------------------------------------- reasons and similar songs
def _structure(relation="unknown", half_double=False):
    return {"tempo": {"half_double_match": half_double}, "key": {"relation": relation}}


def test_reasons_name_shared_artists_and_albums_close_tempos_and_differences():
    audio = {"per_feature": {"energy": 0.95, "danceability": 0.92, "valence": 0.4, "tempo": 0.99}}
    credits = {"artists": ["SZA"], "same_album": True, "album": "SOS"}
    out = sim.reasons({"tempo": 120}, {"tempo": 125}, audio, None, credits, _structure())
    assert out == [
        "Shared artist credit: SZA.",
        "Both appear on the album SOS.",
        "Nearly the same tempo (120 vs 125 BPM).",
        "Very close on energy and danceability.",
        "Noticeably different on valence.",
        "Lyrics were not available for one or both songs, so this score uses audio only.",
    ]


def test_reasons_say_nothing_about_tempo_or_closeness_when_neither_stands_out():
    audio = {"per_feature": {"energy": 0.7, "danceability": 0.7, "valence": 0.7}}
    credits = {"artists": [], "same_album": False, "album": None}
    lyrics = {"shared_themes": [], "emotion_a": "joy", "emotion_b": "joy"}
    out = sim.reasons({"tempo": 90}, {"tempo": 140}, audio, lyrics, credits, _structure())
    assert out == ["Both lean toward joy."]


def test_reasons_skip_a_shared_neutral_tone():
    audio = {"per_feature": {}}
    credits = {"artists": [], "same_album": False, "album": None}
    lyrics = {"shared_themes": [], "emotion_a": "neutral", "emotion_b": "neutral"}
    assert sim.reasons({"tempo": 90}, {"tempo": 140}, audio, lyrics, credits, _structure()) == []


def test_similar_tracks_counts_a_song_once_and_stops_when_the_catalog_runs_out(catalog, lyric_ids, monkeypatch):
    same = {"title": "Same", "artists": ["X"]}
    monkeypatch.setattr(catalog, "brief", lambda row: dict(same))
    out = sim.similar_tracks(catalog, lyric_ids[0], k=5)
    assert len(out) == 1  # every neighbour looks the same, so only one is kept
    monkeypatch.undo()
    everything = sim.similar_tracks(catalog, lyric_ids[0], k=10_000)
    assert len(everything) < 10_000


# ---------------------------------------------------------------- the Vercel entry point
def test_the_vercel_entry_point_exposes_a_flask_app():
    index = importlib.import_module("index")
    assert index.app.name == "app"
    assert "/api/compare" in {rule.rule for rule in index.app.url_map.iter_rules()}


def test_reasons_note_tempos_that_line_up_in_half_or_double_time():
    credits = {"artists": [], "same_album": False, "album": None}
    out = sim.reasons({"tempo": 70}, {"tempo": 140}, {"per_feature": {}}, None, credits, _structure(half_double=True))
    assert out[0] == "Tempos line up in half time or double time."
