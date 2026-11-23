"""The API's entrypoint on Vercel (the `api` service in the repository's vercel.json).

The build (``vercel_build.py``) ingests the catalog into ``catalog.db`` next to this file. A
function's own files are read-only, so on a cold start the catalog is copied to ``/tmp`` and
served from there; writes (sign-in sessions, events) then last only as long as the instance.
Set ``SONGNEXUS_DATABASE_URL`` to a PostgreSQL database (with the catalog ingested into it) for
accounts that persist.

Defaults for a deployment that sets nothing: the ``demo`` environment, allowed origins from
Vercel's own URLs, and sign-in off when no Firebase project is configured. Anything set in the
project's environment variables wins.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "src"))  # the package, whether or not it was installed

BUNDLED_CATALOG = HERE / "catalog.db"
RUNTIME_CATALOG = Path(os.environ.get("SONGNEXUS_RUNTIME_DB", "/tmp/songnexus.db"))  # noqa: S108


def _prepare_catalog() -> None:
    """Copies the bundled catalog to writable storage, once per instance."""
    if os.environ["SONGNEXUS_DATABASE_URL"].startswith("sqlite") and not RUNTIME_CATALOG.exists():
        RUNTIME_CATALOG.parent.mkdir(parents=True, exist_ok=True)
        partial = RUNTIME_CATALOG.with_suffix(".partial")
        shutil.copyfile(BUNDLED_CATALOG, partial)
        partial.replace(RUNTIME_CATALOG)


from songnexus.service.deploy import vercel_defaults  # noqa: E402 - after sys.path

os.environ.update(vercel_defaults(os.environ, PurePosixPath(RUNTIME_CATALOG.as_posix())))
_prepare_catalog()

from songnexus.service.app import create_app  # noqa: E402 - after the environment is set

app = create_app()
# Load the catalog now: a serverless runtime may not run the app's startup hook.
app.state.songnexus.holder.refresh()
