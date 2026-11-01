"""add group deal joins

Revision ID: c9e4a2d7f1b6
Revises: b7d1f3a9c5e2
Create Date: 2026-11-01 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'c9e4a2d7f1b6'
down_revision: Union[str, Sequence[str], None] = 'b7d1f3a9c5e2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0037_group_deal_joins.sql's tables and columns (its RLS and
    erase_user_data live only in the Supabase SQL migration)."""
    op.execute("""
        CREATE TABLE IF NOT EXISTS group_commits (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            deal_id uuid NOT NULL REFERENCES group_deals (id) ON DELETE CASCADE,
            customer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            household_key text NOT NULL,
            status text NOT NULL DEFAULT 'pending_card',
            units smallint NOT NULL DEFAULT 1,
            fulfillment_method text NOT NULL,
            delivery_starts_at timestamptz,
            delivery_ends_at timestamptz,
            delivery_fee numeric(10, 2) NOT NULL DEFAULT 0,
            member_at_join boolean NOT NULL DEFAULT false,
            stripe_setup_intent_id text,
            stripe_payment_method_id text,
            order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
            joined_at timestamptz,
            withdrawn_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS group_commits_one_per_household
        ON group_commits (deal_id, household_key) WHERE status IN ('active', 'ordered')
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS group_commits_one_per_customer
        ON group_commits (deal_id, customer_id) WHERE status IN ('pending_card', 'active', 'ordered')
    """)
    op.execute("ALTER TABLE group_deals ADD COLUMN IF NOT EXISTS extended_once boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE group_deals ADD COLUMN IF NOT EXISTS closed_at timestamptz")
    op.execute("ALTER TABLE group_deals ADD COLUMN IF NOT EXISTS fallback_ends_at timestamptz")
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS group_deal_id uuid REFERENCES group_deals (id) ON DELETE SET NULL")
    op.execute("ALTER TABLE store_order_items ADD COLUMN IF NOT EXISTS stock_units integer")


def downgrade() -> None:
    op.execute("ALTER TABLE store_order_items DROP COLUMN IF EXISTS stock_units")
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS group_deal_id")
    op.execute("ALTER TABLE group_deals DROP COLUMN IF EXISTS fallback_ends_at")
    op.execute("ALTER TABLE group_deals DROP COLUMN IF EXISTS closed_at")
    op.execute("ALTER TABLE group_deals DROP COLUMN IF EXISTS extended_once")
    op.execute("DROP TABLE IF EXISTS group_commits")
