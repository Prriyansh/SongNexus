"""Accounts are Google accounts: tokens from any other Firebase sign-in method are refused."""

from typing import Any

import pytest

from songnexus.identity.tokens import GOOGLE_PROVIDER, InvalidIdTokenError, require_google


def _claims(provider: object, uid: str = "abc123") -> dict[str, Any]:
    return {"uid": uid, "sub": uid, "firebase": {"sign_in_provider": provider}}


def test_a_google_sign_in_is_accepted() -> None:
    assert require_google(_claims(GOOGLE_PROVIDER)) == "abc123"


@pytest.mark.parametrize(
    "provider", ["password", "anonymous", "phone", "custom", "github.com", None]
)
def test_every_other_sign_in_method_is_refused(provider: object) -> None:
    with pytest.raises(InvalidIdTokenError, match="not Google"):
        require_google(_claims(provider))


def test_claims_without_firebase_details_are_refused() -> None:
    with pytest.raises(InvalidIdTokenError):
        require_google({"uid": "abc123"})


def test_a_google_token_without_a_subject_is_refused() -> None:
    with pytest.raises(InvalidIdTokenError, match="no subject"):
        require_google(_claims(GOOGLE_PROVIDER, uid=""))
