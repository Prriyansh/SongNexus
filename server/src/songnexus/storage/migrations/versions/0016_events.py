"""Concerts and festivals from MusicBrainz, and the catalog artists who performed.

Revision ID: 0016
Revises: 0015
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=512), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=True),
        sa.Column("date", sa.String(length=10), nullable=True),
        sa.Column("place", sa.String(length=512), nullable=True),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_events")),
    )
    op.create_table(
        "event_performers",
        sa.Column("event_id", sa.String(length=36), nullable=False),
        sa.Column("artist_id", sa.String(length=36), nullable=False),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["events.id"],
            name=op.f("fk_event_performers_event_id_events"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.id"],
            name=op.f("fk_event_performers_artist_id_artists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("event_id", "artist_id", name=op.f("pk_event_performers")),
    )
    op.create_index(
        op.f("ix_event_performers_artist_id"), "event_performers", ["artist_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_event_performers_artist_id"), table_name="event_performers")
    op.drop_table("event_performers")
    op.drop_table("events")
