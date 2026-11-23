"""Verification of Firebase ID tokens, once, at sign-in."""

from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any, Protocol

GOOGLE_PROVIDER = "google.com"


class InvalidIdTokenError(Exception):
    """The ID token is malformed, expired, revoked, for another project, or not from Google."""


def require_google(claims: dict[str, Any]) -> str:
    """The UID in verified token claims, provided the account signed in with Google.

    Firebase records how the user signed in (``firebase.sign_in_provider``). SongNexus accounts
    are Google accounts only, so a token from any other method (email and password, anonymous,
    phone, a custom token) is refused even if the Firebase project allows that method.

    Raises:
        InvalidIdTokenError: The token has no subject or did not come from Google Sign-In.
    """
    firebase = claims.get("firebase")
    provider = firebase.get("sign_in_provider") if isinstance(firebase, dict) else None
    if provider != GOOGLE_PROVIDER:
        raise InvalidIdTokenError(f"sign-in provider {provider!r} is not Google")
    uid = claims.get("uid") or claims.get("sub")
    if not isinstance(uid, str) or not uid:
        raise InvalidIdTokenError("token has no subject")
    return uid


@dataclass(frozen=True)
class VerifiedIdentity:
    """Who an ID token proves the caller is. Only the stable UID is kept."""

    uid: str


class IdTokenVerifier(Protocol):
    """Turns an ID token into a verified identity."""

    def verify(self, id_token: str) -> VerifiedIdentity:
        """Returns the identity in a valid token.

        Raises:
            InvalidIdTokenError: The token is not valid for this project.
        """
        ...


class FirebaseIdTokenVerifier:
    """Verifies tokens with the Firebase Admin SDK.

    Checks signature, audience (project), issuer and expiry, and that the user signed in with
    Google (``require_google``). Set
    ``FIREBASE_AUTH_EMULATOR_HOST`` to verify emulator tokens locally; the SDK
    then accepts the emulator's unsigned tokens, so never set it in production.
    """

    def __init__(self, project_id: str) -> None:
        """Creates a verifier for one Firebase project."""
        self._project_id = project_id
        self._app: Any = None
        self._lock = threading.Lock()

    def _firebase_app(self) -> Any:
        with self._lock:
            if self._app is None:
                import firebase_admin  # noqa: PLC0415 - heavy import, only when signing in

                self._app = firebase_admin.initialize_app(
                    options={"projectId": self._project_id}, name="songnexus-identity"
                )
            return self._app

    def verify(self, id_token: str) -> VerifiedIdentity:
        """Returns the identity in a valid token.

        Raises:
            InvalidIdTokenError: The token is not valid for this project.
        """
        from firebase_admin import auth  # noqa: PLC0415

        try:
            claims = auth.verify_id_token(id_token, app=self._firebase_app(), clock_skew_seconds=10)
        except (ValueError, auth.InvalidIdTokenError, auth.CertificateFetchError) as exc:
            raise InvalidIdTokenError(type(exc).__name__) from exc
        return VerifiedIdentity(require_google(claims))


class SignInDisabledVerifier:
    """Refuses every token: this deployment serves without accounts (``sign_in`` is off)."""

    def verify(self, id_token: str) -> VerifiedIdentity:
        """Never returns.

        Raises:
            InvalidIdTokenError: Always.
        """
        del id_token
        raise InvalidIdTokenError("sign-in is not offered on this deployment")
