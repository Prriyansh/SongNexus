"""Settings a Vercel deployment needs when its environment doesn't set them (``server/main.py``).

A deployment that sets nothing serves the catalog built into ``catalog.db`` from writable
storage, in the ``demo`` environment, accepting writes only from Vercel's own https URLs, and
without accounts unless a Firebase project is configured, calling the song_compare service
on the production domain. Anything set explicitly wins.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from pathlib import PurePosixPath

VERCEL_HOST_VARIABLES = ("VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_BRANCH_URL", "VERCEL_URL")


def vercel_defaults(env: Mapping[str, str], runtime_db: PurePosixPath) -> dict[str, str]:
    """Returns the ``SONGNEXUS_*`` variables to add to ``env`` (never ones it already sets)."""
    out: dict[str, str] = {}
    if "SONGNEXUS_DATABASE_URL" not in env:
        out["SONGNEXUS_DATABASE_URL"] = f"sqlite:///{runtime_db}"
    if "SONGNEXUS_ENVIRONMENT" not in env:
        out["SONGNEXUS_ENVIRONMENT"] = "demo"
    if "SONGNEXUS_ALLOWED_ORIGINS" not in env:
        hosts = {env.get(name, "").strip() for name in VERCEL_HOST_VARIABLES}
        out["SONGNEXUS_ALLOWED_ORIGINS"] = json.dumps(sorted(f"https://{h}" for h in hosts if h))
    if "SONGNEXUS_SIGN_IN" not in env and not env.get("SONGNEXUS_FIREBASE_PROJECT_ID"):
        out["SONGNEXUS_SIGN_IN"] = "false"
    production = env.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip()
    if "SONGNEXUS_SONG_COMPARE_URL" not in env and production:
        # song_compare is this project's `sound` service, at /api on the production domain
        # (deployment URLs sit behind Vercel's login, so a server can't call them).
        out["SONGNEXUS_SONG_COMPARE_URL"] = f"https://{production}"
    if "SONGNEXUS_LOG_JSON" not in env:
        out["SONGNEXUS_LOG_JSON"] = "true"
    return out
