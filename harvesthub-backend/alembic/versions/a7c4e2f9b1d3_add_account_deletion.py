"""add account deletion columns

Revision ID: a7c4e2f9b1d3
Revises: f3b8e1a6c2d9
Create Date: 2026-10-05 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c4e2f9b1d3'
down_revision: Union[str, Sequence[str], None] = 'f3b8e1a6c2d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror the column added by 0027_account_deletion.sql. Same raw
    IF NOT EXISTS discipline as every prior revision — the status
    constraint, the dropped auth.users foreign key, erase_user_data() and
    the auth.users delete trigger live only in the Supabase SQL migration."""
    op.execute("ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE profiles DROP COLUMN IF EXISTS deleted_at")
