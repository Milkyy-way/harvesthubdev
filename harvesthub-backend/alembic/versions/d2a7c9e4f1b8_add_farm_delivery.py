"""add farm delivery (settings, windows, runs, stops)

Revision ID: d2a7c9e4f1b8
Revises: c6e1f4a8b2d5
Create Date: 2026-10-27 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd2a7c9e4f1b8'
down_revision: Union[str, Sequence[str], None] = 'c6e1f4a8b2d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror the tables and columns 0032_farm_delivery.sql adds. Same raw
    IF NOT EXISTS discipline as every prior revision — foreign keys,
    checks, the status constraint, the photo bucket, RLS and
    erase_user_data() live only in the Supabase SQL migration."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS farm_delivery_settings (
          farmer_id uuid PRIMARY KEY,
          offers_delivery boolean NOT NULL DEFAULT false,
          delivery_fee numeric(10, 2) NOT NULL DEFAULT 5.00,
          radius_miles numeric(4, 1) NOT NULL DEFAULT 10,
          cutoff_hours integer NOT NULL DEFAULT 24,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS farm_delivery_windows (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          farmer_id uuid NOT NULL,
          weekday smallint NOT NULL,
          start_time time NOT NULL,
          end_time time NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS delivery_runs (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          farmer_id uuid NOT NULL,
          provider text NOT NULL DEFAULT 'farm',
          window_starts_at timestamptz NOT NULL,
          window_ends_at timestamptz NOT NULL,
          status text NOT NULL DEFAULT 'scheduled',
          started_at timestamptz,
          completed_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (farmer_id, window_starts_at)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS delivery_stops (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          run_id uuid NOT NULL,
          kind text NOT NULL DEFAULT 'home',
          sequence integer,
          latitude double precision,
          longitude double precision,
          status text NOT NULL DEFAULT 'pending',
          delivered_at timestamptz,
          photo_path text,
          note text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS delivery_stop_id uuid")
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS delivery_window_starts_at timestamptz")
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS delivery_window_ends_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS delivery_window_ends_at")
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS delivery_window_starts_at")
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS delivery_stop_id")
    op.execute("DROP TABLE IF EXISTS delivery_stops")
    op.execute("DROP TABLE IF EXISTS delivery_runs")
    op.execute("DROP TABLE IF EXISTS farm_delivery_windows")
    op.execute("DROP TABLE IF EXISTS farm_delivery_settings")
