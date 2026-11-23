"""Billboard Hot 100 summaries for catalog songs and artists.

Revision ID: 0015
Revises: 0014
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: str | None = "0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recording_charts",
        sa.Column("recording_id", sa.String(length=36), nullable=False),
        sa.Column("peak", sa.Integer(), nullable=False),
        sa.Column("weeks", sa.Integer(), nullable=False),
        sa.Column("first_week", sa.Date(), nullable=False),
        sa.Column("last_week", sa.Date(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["recording_id"],
            ["recordings.id"],
            name=op.f("fk_recording_charts_recording_id_recordings"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("recording_id", name=op.f("pk_recording_charts")),
    )
    op.create_table(
        "artist_charts",
        sa.Column("artist_id", sa.String(length=36), nullable=False),
        sa.Column("entries", sa.Integer(), nullable=False),
        sa.Column("top_ten", sa.Integer(), nullable=False),
        sa.Column("number_ones", sa.Integer(), nullable=False),
        sa.Column("best_peak", sa.Integer(), nullable=False),
        sa.Column("first_week", sa.Date(), nullable=False),
        sa.Column("last_week", sa.Date(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.id"],
            name=op.f("fk_artist_charts_artist_id_artists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("artist_id", name=op.f("pk_artist_charts")),
    )


def downgrade() -> None:
    op.drop_table("artist_charts")
    op.drop_table("recording_charts")
