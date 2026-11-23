"""Album covers: a release group's front cover from the Cover Art Archive.

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "release_covers",
        sa.Column("release_id", sa.String(length=36), nullable=False),
        sa.Column("thumbnail_url", sa.String(length=2048), nullable=False),
        sa.Column("large_url", sa.String(length=2048), nullable=False),
        sa.Column("page_url", sa.String(length=2048), nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["release_id"],
            ["releases.id"],
            name=op.f("fk_release_covers_release_id_releases"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("release_id", name=op.f("pk_release_covers")),
    )


def downgrade() -> None:
    op.drop_table("release_covers")
