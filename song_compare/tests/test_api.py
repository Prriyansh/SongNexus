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
