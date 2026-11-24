"""Billboard 200 album runs, Rolling Stone's 500 Greatest Albums and Eurovision entries.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _artist_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["artist_id"],
        ["artists.id"],
        name=op.f(f"fk_{table}_artist_id_artists"),
        ondelete="CASCADE",
    )


def upgrade() -> None:
    op.create_table(
        "album_chart_runs",
        sa.Column("artist_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("peak", sa.Integer(), nullable=False),
        sa.Column("weeks", sa.Integer(), nullable=False),
        sa.Column("first_week", sa.Date(), nullable=False),
        sa.Column("last_week", sa.Date(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        _artist_fk("album_chart_runs"),
        sa.PrimaryKeyConstraint("artist_id", "title", name=op.f("pk_album_chart_runs")),
    )
    op.create_table(
        "greatest_albums",
        sa.Column("artist_id", sa.String(length=36), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("release_year", sa.Integer(), nullable=True),
        sa.Column("rank_2003", sa.Integer(), nullable=True),
        sa.Column("rank_2012", sa.Integer(), nullable=True),
        sa.Column("rank_2020", sa.Integer(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        _artist_fk("greatest_albums"),
        sa.PrimaryKeyConstraint("artist_id", "title", name=op.f("pk_greatest_albums")),
    )
    op.create_table(
        "eurovision_entries",
        sa.Column("artist_id", sa.String(length=36), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("country", sa.String(length=128), nullable=False),
        sa.Column("song", sa.String(length=512), nullable=False),
        sa.Column("place_final", sa.Integer(), nullable=True),
        sa.Column("points_final", sa.Integer(), nullable=True),
        sa.Column("place_semi_final", sa.Integer(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        _artist_fk("eurovision_entries"),
        sa.PrimaryKeyConstraint("artist_id", "year", "country", name=op.f("pk_eurovision_entries")),
    )


def downgrade() -> None:
    op.drop_table("eurovision_entries")
    op.drop_table("greatest_albums")
    op.drop_table("album_chart_runs")
