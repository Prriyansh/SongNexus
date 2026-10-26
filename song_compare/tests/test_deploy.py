"""Guards for deploying the API on its own (e.g. a Vercel Python function, 500 MB limit)."""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def test_serving_does_not_import_data_prep_packages():
    # scikit-learn and vaderSentiment are only for rebuilding data; keeping them out of the
    # runtime keeps the deployed bundle small.
    code = (
        "import sys; sys.path[:0] = ['backend', '.']\n"
        "from app import create_app\n"
        "create_app('tests')\n"  # no data there: the app starts without loading a catalog
        "heavy = [m for m in ('sklearn', 'vaderSentiment', 'datasets') if m in sys.modules]\n"
        "print(','.join(heavy))\n"
    )
    out = subprocess.run([sys.executable, "-c", code], cwd=ROOT, capture_output=True, text=True, check=True)
    assert out.stdout.strip() == ""


def test_runtime_requirements_leave_out_data_prep_packages():
    runtime = (ROOT / "requirements.txt").read_text().lower()
    assert "scikit-learn" not in runtime and "vadersentiment" not in runtime and "pytest" not in runtime
    assert "-r requirements.txt" in (ROOT / "requirements-prepare.txt").read_text()
    assert "-r requirements-prepare.txt" in (ROOT / "requirements-dev.txt").read_text()
