"""Taste feedback through the API: give it, list it, and take it back by name."""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from songnexus.config import Settings
from songnexus.service.app import build_state
from songnexus.service.deps import AppState
from tests.service.databases import fresh_database_url, migrated_with_catalog
from tests.service.test_identity import BOB, FakeVerifier, new_client, reason, sign_in


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    url = fresh_database_url(tmp_path)
    migrated_with_catalog(url, tmp_path)
    state: AppState = build_state(
        Settings(database_url=url, log_json=False, read_model_refresh_s=3600)
    )
    state.verifier = FakeVerifier()
    with new_client(state) as test_client:
        sign_in(test_client, "ana")
        yield test_client
    state.engine.dispose()


def test_feedback_is_undone_by_its_name(client: TestClient) -> None:
    given = client.post(
        "/v1/users/me/tasteFeedback", json={"kind": "MORE_LIKE_THIS", "artist": f"artists/{BOB}"}
    )
    assert given.status_code == 200, given.text
    name = given.json()["name"]
    feedback = name.rsplit("/", 1)[1]
    assert feedback == f"MORE_LIKE_THIS.artists.{BOB}"
    listed = client.get("/v1/users/me/tasteFeedback").json()["tasteFeedback"]
    assert [f["name"] for f in listed] == [name]

    deleted = client.delete(f"/v1/users/me/tasteFeedback/{feedback}")
    assert deleted.status_code == 200, deleted.text
    assert client.get("/v1/users/me/tasteFeedback").json()["tasteFeedback"] == []

    again = client.delete(f"/v1/users/me/tasteFeedback/{feedback}")
    assert again.status_code == 404
    assert reason(again) == "FEEDBACK_NOT_FOUND"


def test_a_malformed_feedback_name_is_rejected(client: TestClient) -> None:
    response = client.delete("/v1/users/me/tasteFeedback/not-a-feedback-name")
    assert response.status_code == 400
