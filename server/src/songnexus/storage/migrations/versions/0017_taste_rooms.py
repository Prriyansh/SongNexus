"""Playlist rooms: two playlists joined by a short code, kept for a week.

Revision ID: 0017
Revises: 0016
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0017"
down_revision: str | None = "0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "taste_rooms",
        sa.Column("code", sa.String(length=6), nullable=False),
        sa.Column("host_name", sa.String(length=30), nullable=False),
        sa.Column("host_tracks", JSON, nullable=False),
        sa.Column("guest_name", sa.String(length=30), nullable=True),
        sa.Column("guest_tracks", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("code", name=op.f("pk_taste_rooms")),
    )
    op.create_index(op.f("ix_taste_rooms_expires_at"), "taste_rooms", ["expires_at"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_taste_rooms_expires_at"), table_name="taste_rooms")
    op.drop_table("taste_rooms")
