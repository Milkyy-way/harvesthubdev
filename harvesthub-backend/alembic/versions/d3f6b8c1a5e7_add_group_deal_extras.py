"""add group deal extras

Revision ID: d3f6b8c1a5e7
Revises: c9e4a2d7f1b6
Create Date: 2026-11-01 22:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'd3f6b8c1a5e7'
down_revision: Union[str, Sequence[str], None] = 'c9e4a2d7f1b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0038_group_deal_extras.sql's tables and columns (its RLS and
    erase_user_data live only in the Supabase SQL migration)."""
    op.execute("ALTER TABLE group_commits ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES pods (id) ON DELETE SET NULL")
    op.execute("ALTER TABLE group_commits ADD COLUMN IF NOT EXISTS pod_full_fee numeric(10, 2)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS group_waitlist (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            deal_id uuid NOT NULL REFERENCES group_deals (id) ON DELETE CASCADE,
            customer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            household_key text NOT NULL,
            status text NOT NULL DEFAULT 'waiting',
            offered_at timestamptz,
            offer_expires_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS group_waitlist_one_per_household
        ON group_waitlist (deal_id, household_key) WHERE status IN ('waiting', 'offered')
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS group_waitlist_one_per_customer
        ON group_waitlist (deal_id, customer_id) WHERE status IN ('waiting', 'offered')
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS farm_follows (
            customer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            farmer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (customer_id, farmer_id)
        )
    """)
    op.execute("ALTER TABLE group_deals ADD COLUMN IF NOT EXISTS members_told_at timestamptz")
    op.execute("ALTER TABLE group_deals ADD COLUMN IF NOT EXISTS public_told_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE group_deals DROP COLUMN IF EXISTS public_told_at")
    op.execute("ALTER TABLE group_deals DROP COLUMN IF EXISTS members_told_at")
    op.execute("DROP TABLE IF EXISTS farm_follows")
    op.execute("DROP TABLE IF EXISTS group_waitlist")
    op.execute("ALTER TABLE group_commits DROP COLUMN IF EXISTS pod_full_fee")
    op.execute("ALTER TABLE group_commits DROP COLUMN IF EXISTS pod_id")
