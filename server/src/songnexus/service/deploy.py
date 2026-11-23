"""Settings a Vercel deployment needs when its environment doesn't set them (``server/main.py``).

A deployment that sets nothing serves its hosted PostgreSQL database when the project has one
(Vercel's Neon integration), else the catalog built into ``catalog.db``, copied to writable
storage. It runs in the ``demo`` environment, accepts writes only from Vercel's own https URLs,
has no accounts unless a Firebase project is configured, and calls the song_compare service on
the production domain. Anything set explicitly wins.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import PurePosixPath

VERCEL_HOST_VARIABLES = ("VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_BRANCH_URL", "VERCEL_URL")
# What a hosted PostgreSQL integration sets (Vercel's Neon integration sets all four): pooled
# connections for serving, direct ones for migrations and bulk loads.
POOLED_URL_VARIABLES = ("DATABASE_URL", "POSTGRES_URL")
DIRECT_URL_VARIABLES = ("DATABASE_URL_UNPOOLED", "POSTGRES_URL_NON_POOLING")


def hosted_database_url(env: Mapping[str, str], *, direct: bool = False) -> str | None:
    """The hosted PostgreSQL database's URL for SQLAlchemy (psycopg), or None if there is none.

    ``direct`` prefers the unpooled connection (migrations and ingest hold one long transaction,
    which a transaction pooler would cut); serving prefers the pooled one.
    """
    names = (
        DIRECT_URL_VARIABLES + POOLED_URL_VARIABLES
        if direct
        else POOLED_URL_VARIABLES + DIRECT_URL_VARIABLES
    )
    for name in names:
        value = env.get(name, "").strip()
        if value.startswith(("postgres://", "postgresql://")):
            return "postgresql+psycopg://" + value.split("://", 1)[1]
    return None


def vercel_defaults(env: Mapping[str, str], runtime_db: PurePosixPath) -> dict[str, str]:
    """Returns the ``SONGNEXUS_*`` variables to add to ``env`` (never ones it already sets)."""
    out: dict[str, str] = {}
    if "SONGNEXUS_DATABASE_URL" not in env:
        # A hosted database when the project has one (accounts persist); otherwise the catalog
        # bundled with the function, copied to writable storage.
        out["SONGNEXUS_DATABASE_URL"] = hosted_database_url(env) or f"sqlite:///{runtime_db}"
    if "SONGNEXUS_ENVIRONMENT" not in env:
        out["SONGNEXUS_ENVIRONMENT"] = "demo"
    if "SONGNEXUS_ALLOWED_ORIGINS" not in env:
        hosts = {env.get(name, "").strip() for name in VERCEL_HOST_VARIABLES}
        out["SONGNEXUS_ALLOWED_ORIGINS"] = json.dumps(sorted(f"https://{h}" for h in hosts if h))
    # Sign-in with Google: the web app's Firebase project is the API's too, so setting the
    # VITE_FIREBASE_* variables once turns accounts on. Without a project there are none.
    web_project = env.get("VITE_FIREBASE_PROJECT_ID", "").strip()
    if not env.get("SONGNEXUS_FIREBASE_PROJECT_ID") and web_project:
        out["SONGNEXUS_FIREBASE_PROJECT_ID"] = web_project
    project = env.get("SONGNEXUS_FIREBASE_PROJECT_ID") or out.get("SONGNEXUS_FIREBASE_PROJECT_ID")
    if "SONGNEXUS_SIGN_IN" not in env and not project:
        out["SONGNEXUS_SIGN_IN"] = "false"
    production = env.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    if "SONGNEXUS_SONG_COMPARE_URL" not in env and production:
        # song_compare is this project's `sound` service, at /api on the production domain
        # (deployment URLs sit behind Vercel's login, so a server can't call them).
        out["SONGNEXUS_SONG_COMPARE_URL"] = f"https://{production}"
    if "SONGNEXUS_LOG_JSON" not in env:
        out["SONGNEXUS_LOG_JSON"] = "true"
    return out
