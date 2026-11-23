"""Deployment settings: Vercel defaults, serving without accounts, and what startup refuses."""

import json
from pathlib import Path, PurePosixPath

import pytest

from songnexus.config import ConfigError, Settings, validate_for_serving
from songnexus.identity.tokens import InvalidIdTokenError, SignInDisabledVerifier
from songnexus.service.app import build_state
from songnexus.service.deploy import hosted_database_url, vercel_defaults

RUNTIME = PurePosixPath("/tmp/songnexus.db")


def test_a_bare_vercel_deployment_gets_safe_defaults() -> None:
    env = {
        "VERCEL_URL": "songnexus-abc.vercel.app",
        "VERCEL_PROJECT_PRODUCTION_URL": "songnexus.vercel.app",
    }
    out = vercel_defaults(env, RUNTIME)
    assert out["SONGNEXUS_DATABASE_URL"] == "sqlite:////tmp/songnexus.db"
    assert out["SONGNEXUS_ENVIRONMENT"] == "demo"
    assert json.loads(out["SONGNEXUS_ALLOWED_ORIGINS"]) == [
        "https://songnexus-abc.vercel.app",
        "https://songnexus.vercel.app",
    ]
    assert out["SONGNEXUS_SIGN_IN"] == "false"  # no Firebase project: no accounts
    assert out["SONGNEXUS_SONG_COMPARE_URL"] == "https://songnexus.vercel.app"


def test_explicit_settings_always_win() -> None:
    env = {
        "SONGNEXUS_DATABASE_URL": "postgresql+psycopg://db/songnexus",
        "SONGNEXUS_ENVIRONMENT": "production",
        "SONGNEXUS_ALLOWED_ORIGINS": '["https://songnexus.app"]',
        "SONGNEXUS_FIREBASE_PROJECT_ID": "songnexus",
        "SONGNEXUS_LOG_JSON": "false",
        "SONGNEXUS_SONG_COMPARE_URL": "https://sound.example",
        "VERCEL_PROJECT_PRODUCTION_URL": "songnexus.vercel.app",
    }
    assert vercel_defaults(env, RUNTIME) == {}


def test_the_defaults_pass_startup_validation() -> None:
    env = {"VERCEL_URL": "songnexus-abc.vercel.app"}
    out = vercel_defaults(env, RUNTIME)
    settings = Settings(
        environment=out["SONGNEXUS_ENVIRONMENT"],
        allowed_origins=json.loads(out["SONGNEXUS_ALLOWED_ORIGINS"]),
        sign_in=out["SONGNEXUS_SIGN_IN"] == "true",
        firebase_project_id="",
    )
    validate_for_serving(settings, {})


def test_sign_in_still_needs_a_firebase_project_when_on() -> None:
    settings = Settings(
        environment="demo", allowed_origins=["https://songnexus.app"], firebase_project_id=""
    )
    with pytest.raises(ConfigError, match="FIREBASE_PROJECT_ID"):
        validate_for_serving(settings, {})


def test_without_accounts_every_token_is_refused() -> None:
    with pytest.raises(InvalidIdTokenError):
        SignInDisabledVerifier().verify("anything")


def test_without_accounts_the_sign_in_flag_is_off() -> None:
    settings = Settings(
        database_url="sqlite://", environment="development", sign_in=False, log_json=False
    )
    state = build_state(settings)
    assert state.flags["signIn"] is False
    assert isinstance(state.verifier, SignInDisabledVerifier)
    on = build_state(Settings(database_url="sqlite://", environment="development", log_json=False))
    assert on.flags["signIn"] is True


def test_vercel_routes_each_service_and_sets_the_security_headers() -> None:
    root = Path(__file__).resolve().parents[3]
    vercel = json.loads((root / "vercel.json").read_text(encoding="utf-8"))
    routes = {r["source"]: r["destination"] for r in vercel["rewrites"]}
    assert routes["/v1/(.*)"] == {"service": "api"}
    assert routes["/healthz"] == {"service": "api"}
    assert routes["/api/(.*)"] == {"service": "sound"}  # song_compare
    assert list(routes)[-1] == "/(.*)"  # the web app last: routing is first match
    api = vercel["services"]["api"]
    assert (api["root"], api["entrypoint"]) == ("server/", "main:app")
    sound = vercel["services"]["sound"]
    assert (sound["root"], sound["entrypoint"]) == ("song_compare/", "index:app")
    excluded = api["functions"]["main.py"]["excludeFiles"]
    assert "catalog.db" not in excluded
    assert "src/" not in excluded
    web_headers = next(h for h in vercel["services"]["web"]["headers"] if h["source"] == "/(.*)")
    headers = {h["key"]: h["value"] for h in web_headers["headers"]}
    csp = headers["Content-Security-Policy"]
    for directive in ("default-src 'self'", "object-src 'none'", "frame-ancestors 'none'"):
        assert directive in csp
    assert headers["Strict-Transport-Security"].startswith("max-age=")
    assert headers["X-Content-Type-Options"] == "nosniff"


NEON = {
    "DATABASE_URL": "postgresql://u:p@ep-pooler.neon.tech/neondb?sslmode=require",
    "DATABASE_URL_UNPOOLED": "postgresql://u:p@ep-direct.neon.tech/neondb?sslmode=require",
}


def test_a_hosted_database_is_used_when_the_project_has_one() -> None:
    out = vercel_defaults({**NEON, "VERCEL_URL": "x.vercel.app"}, RUNTIME)
    # Serving uses the pooled connection, through psycopg.
    assert out["SONGNEXUS_DATABASE_URL"] == (
        "postgresql+psycopg://u:p@ep-pooler.neon.tech/neondb?sslmode=require"
    )


def test_bulk_work_uses_the_direct_connection() -> None:
    assert hosted_database_url(NEON, direct=True) == (
        "postgresql+psycopg://u:p@ep-direct.neon.tech/neondb?sslmode=require"
    )
    assert hosted_database_url({"POSTGRES_URL": "postgres://u:p@h/db"}) == (
        "postgresql+psycopg://u:p@h/db"
    )


def test_anything_else_is_not_a_hosted_database() -> None:
    assert hosted_database_url({"DATABASE_URL": "mysql://u:p@h/db"}) is None
    assert hosted_database_url({}) is None
    out = vercel_defaults({"DATABASE_URL": "mysql://u:p@h/db"}, RUNTIME)
    assert out["SONGNEXUS_DATABASE_URL"] == "sqlite:////tmp/songnexus.db"
