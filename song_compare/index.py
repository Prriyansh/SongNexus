"""
Entry point for hosting the API as a Vercel Python function: Vercel looks for a Flask instance
named `app` in index.py. Locally, run `python backend/app.py` instead.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from app import create_app  # noqa: E402  (backend/app.py, importable once backend/ is on the path)

app = create_app()
