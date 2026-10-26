"""Shared fixtures: a small catalog built from the demo data, the same way the real one is built."""
import pytest

from make_demo_data import write_demo
import prepare_data


@pytest.fixture(scope="session")
def demo_dir(tmp_path_factory):
    """Runs make_demo_data + prepare_data into a temp folder once per test run."""
    root = tmp_path_factory.mktemp("song_compare")
    spotify_csv, genius_csv = write_demo(root / "raw")
    out = root / "processed"
    prepare_data.prepare(spotify_csv, genius_csv, out=out)
    return out


@pytest.fixture(scope="session")
def catalog(demo_dir):
    from catalog import Catalog
    return Catalog(demo_dir)


@pytest.fixture()
def client(demo_dir):
    from app import create_app
    return create_app(demo_dir).test_client()


@pytest.fixture(scope="session")
def lyric_ids(catalog):
    """Two track ids that both have lyric features."""
    t = catalog.tracks
    return t.loc[t.lyric_row >= 0, "track_id"].head(2).tolist()
