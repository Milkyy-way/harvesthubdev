"""add free month identifiers and customer places

Revision ID: e7a1c4f9b2d6
Revises: d3f6b8c1a5e7
Create Date: 2026-11-01 23:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'e7a1c4f9b2d6'
down_revision: Union[str, Sequence[str], None] = 'd3f6b8c1a5e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0039_free_month_and_places.sql's tables and column (its RLS and
    erase_user_data live only in the Supabase SQL migration)."""
    op.execute("""
        CREATE TABLE IF NOT EXISTS free_month_identifiers (
            identifier_hash text PRIMARY KEY,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS customer_places (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            customer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            name text NOT NULL,
            address_street text NOT NULL,
            address_city text NOT NULL,
            address_state text NOT NULL,
            address_zip text NOT NULL,
            latitude double precision,
            longitude double precision,
            geocoded_at timestamp,
            created_at timestamp NOT NULL DEFAULT now()
        )
    """)
    op.execute("ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS browse_place_id uuid REFERENCES customer_places (id) ON DELETE SET NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE customer_profiles DROP COLUMN IF EXISTS browse_place_id")
    op.execute("DROP TABLE IF EXISTS customer_places")
    op.execute("DROP TABLE IF EXISTS free_month_identifiers")
