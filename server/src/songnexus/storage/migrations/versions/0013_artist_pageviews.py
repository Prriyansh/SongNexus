"""Artist facts: average monthly Wikipedia pageviews.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("artist_facts", sa.Column("monthly_views", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("artist_facts", "monthly_views")
