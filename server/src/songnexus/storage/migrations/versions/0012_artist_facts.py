"""Artist facts: Wikidata description, Wikipedia introduction, awards and nominations.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "artist_facts",
        sa.Column("artist_id", sa.String(length=36), nullable=False),
        sa.Column("wikidata_id", sa.String(length=32), nullable=False),
        sa.Column("description", sa.String(length=512), nullable=True),
        sa.Column("wikipedia_url", sa.String(length=2048), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("awards", JSON, nullable=False),
        sa.Column("nominations", JSON, nullable=False),
        sa.Column("fetched_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["artist_id"],
            ["artists.id"],
            name=op.f("fk_artist_facts_artist_id_artists"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("artist_id", name=op.f("pk_artist_facts")),
    )


def downgrade() -> None:
    op.drop_table("artist_facts")
