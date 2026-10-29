"""add live delivery tracking (the run's current position)

Revision ID: e5b3d8a1c7f2
Revises: d2a7c9e4f1b8
Create Date: 2026-10-28 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5b3d8a1c7f2'
down_revision: Union[str, Sequence[str], None] = 'd2a7c9e4f1b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0033_live_tracking.sql's columns (the check constraint lives
    only in the Supabase SQL migration)."""
    op.execute("ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS current_latitude double precision")
    op.execute("ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS current_longitude double precision")
    op.execute("ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS current_heading real")
    op.execute("ALTER TABLE delivery_runs ADD COLUMN IF NOT EXISTS location_updated_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE delivery_runs DROP COLUMN IF EXISTS location_updated_at")
    op.execute("ALTER TABLE delivery_runs DROP COLUMN IF EXISTS current_heading")
    op.execute("ALTER TABLE delivery_runs DROP COLUMN IF EXISTS current_longitude")
    op.execute("ALTER TABLE delivery_runs DROP COLUMN IF EXISTS current_latitude")
