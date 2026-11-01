"""add apartments and group deals

Revision ID: b7d1f3a9c5e2
Revises: a4c7e2f9d1b3
Create Date: 2026-11-01 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b7d1f3a9c5e2'
down_revision: Union[str, Sequence[str], None] = 'a4c7e2f9d1b3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0036_apartments_and_group_deals.sql's table and column (its RLS,
    grants and functions live only in the Supabase SQL migration)."""
    op.execute("ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS address_unit text")
    op.execute("""
        CREATE TABLE IF NOT EXISTS group_deals (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            farmer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
            status text NOT NULL DEFAULT 'draft',
            unit text NOT NULL,
            regular_price numeric(10, 2) NOT NULL,
            share_size numeric(8, 2) NOT NULL DEFAULT 1,
            deal_price numeric(10, 2) NOT NULL,
            goal integer NOT NULL,
            capacity integer NOT NULL,
            max_units smallint NOT NULL DEFAULT 1,
            subscriber_fallback boolean NOT NULL DEFAULT true,
            public_start_date date,
            window_days smallint NOT NULL DEFAULT 5,
            fulfillment_date date,
            member_opens_at timestamptz,
            public_opens_at timestamptz,
            deadline_at timestamptz,
            reserved_quantity integer NOT NULL DEFAULT 0,
            published_at timestamptz,
            cancelled_at timestamptz,
            cancel_reason text,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS group_deals")
    op.execute("ALTER TABLE customer_profiles DROP COLUMN IF EXISTS address_unit")
