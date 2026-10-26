import json


def strict_json(response):
    """Parses like a browser: NaN and Infinity are not valid JSON."""
    def reject(value):
        raise ValueError(f"{value} is not valid JSON")
    return json.loads(response.get_data(as_text=True), parse_constant=reject)


def test_stats(client):
    body = strict_json(client.get("/api/stats"))
    assert body["songs"] > 0 and 0 < body["match_rate"] <= 1


def test_search_needs_two_characters(client):
    assert strict_json(client.get("/api/search?q=a")) == {"results": []}


def test_search_returns_brief_tracks(client, catalog):
    title = catalog.tracks.track_name.iloc[0]
    results = strict_json(client.get(f"/api/search?q={title}"))["results"]
    assert results and {"id", "title", "artists", "album", "genre", "has_lyrics"} <= set(results[0])


def test_compare_returns_scores_and_reasons(client, lyric_ids):
    a, b = lyric_ids
    body = strict_json(client.get(f"/api/compare?a={a}&b={b}"))
    assert {"a", "b", "overall", "audio", "lyrics", "credits", "structure", "reasons"} <= set(body)


def test_compare_needs_two_known_ids(client, lyric_ids):
    assert client.get(f"/api/compare?a={lyric_ids[0]}").status_code == 400
    assert client.get(f"/api/compare?a={lyric_ids[0]}&b=nope").status_code == 404


def test_similar(client, lyric_ids):
    results = strict_json(client.get(f"/api/similar/{lyric_ids[0]}?k=4"))["results"]
    assert len(results) == 4
    assert client.get("/api/similar/nope").status_code == 404


def test_frontend_is_served(client):
    response = client.get("/")
    assert response.status_code == 200 and b"Song Compare" in response.data


def test_api_answers_503_without_data(tmp_path):
    from app import create_app
    response = create_app(tmp_path).test_client().get("/api/stats")
    assert response.status_code == 503
    assert "prepare_data.py" in strict_json(response)["error"]


# --- Parameter validation -------------------------------------------------------------------

def test_non_numeric_sizes_are_a_json_400_not_a_crash(client, lyric_ids):
    for url in ["/api/search?q=love&limit=abc", f"/api/similar/{lyric_ids[0]}?k=abc"]:
        response = client.get(url)
        assert response.status_code == 400
        assert "whole number" in strict_json(response)["error"]


def test_sizes_are_clamped(client, catalog, lyric_ids):
    word = catalog.tracks.track_name.iloc[0].split()[0]
    assert len(strict_json(client.get(f"/api/search?q={word}&limit=-3"))["results"]) == 1
    assert len(strict_json(client.get(f"/api/search?q={word}&limit=500"))["results"]) <= 25
    # A negative k used to scan the whole catalog.
    assert len(strict_json(client.get(f"/api/similar/{lyric_ids[0]}?k=-1"))["results"]) == 1
    assert len(strict_json(client.get(f"/api/similar/{lyric_ids[0]}?k=999"))["results"]) == 30


def test_w_audio_must_be_a_finite_number(client, lyric_ids):
    a, b = lyric_ids
    for bad in ["nan", "inf", "-inf", "abc"]:
        response = client.get(f"/api/compare?a={a}&b={b}&w_audio={bad}")
        assert response.status_code == 400, bad
    audio_only = strict_json(client.get(f"/api/compare?a={a}&b={b}&w_audio=5"))  # clamped to 1
    assert audio_only["overall"] == audio_only["audio"]["score"]


def test_comparing_a_song_with_itself_is_refused(client, lyric_ids):
    response = client.get(f"/api/compare?a={lyric_ids[0]}&b={lyric_ids[0]}")
    assert response.status_code == 400
    assert strict_json(response)["error"] == "Pick two different songs."
