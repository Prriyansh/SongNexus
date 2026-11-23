"""Builds the catalog for the Vercel deployment (run by Vercel after installing dependencies).

1. Ingests the committed snapshots in ``../data`` into ``catalog.db`` next to this file (the
   same quality gate as ``songnexus ingest``: a failing catalog fails the build).
2. Unless ``SONGNEXUS_BUILD_FETCH=0``: fetches artist photos and facts (Wikimedia Commons,
   Wikidata, Wikipedia) for the best-known artists, ``SONGNEXUS_BUILD_FETCH_LIMIT`` of them
   (default 1500), so pages have photos and introductions. A failed fetch only leaves them out.
3. Compacts the database, so the function bundle stays small.

Run it locally with ``uv run python vercel_build.py`` to check a deployment's catalog.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "src"))
CATALOG = HERE / "catalog.db"


def _run(*args: str) -> int:
    from songnexus.cli import main  # noqa: PLC0415 - after the environment is set

    print(f"songnexus {' '.join(args)}", flush=True)
    return main(list(args))


def build() -> int:
    """Builds ``catalog.db``; returns the process exit code."""
    os.chdir(HERE)  # the data directory is found from here (../data)
    CATALOG.unlink(missing_ok=True)
    os.environ["SONGNEXUS_DATABASE_URL"] = f"sqlite:///{CATALOG.as_posix()}"
    os.environ.setdefault("SONGNEXUS_ENVIRONMENT", "development")  # building, not serving
    if code := _run("ingest"):
        print("ingest failed: the catalog was rejected", file=sys.stderr)
        return code
    if os.environ.get("SONGNEXUS_BUILD_FETCH", "1") != "0":
        limit = os.environ.get("SONGNEXUS_BUILD_FETCH_LIMIT", "1500")
        for command in ("fetch-images", "fetch-facts"):
            if _run(command, "--limit", limit):
                print(f"{command} failed; continuing without it", file=sys.stderr)
    with sqlite3.connect(CATALOG) as db:
        db.execute("VACUUM")
    print(f"catalog.db: {CATALOG.stat().st_size / 1e6:.1f} MB", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(build())
