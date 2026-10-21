"""harvest pass free period, notifications, precise locations

Revision ID: c6e1f4a8b2d5
Revises: b4d9e7a2c1f8
Create Date: 2026-10-19 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c6e1f4a8b2d5'
down_revision: Union[str, Sequence[str], None] = 'b4d9e7a2c1f8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0029_harvest_pass_free_period.sql, 0030_notifications.sql and
    0031_precise_locations.sql. Same raw IF NOT EXISTS discipline as every
    prior revision — foreign keys, checks, RLS, the address-change trigger
    and the column grants live only in the Supabase SQL migrations."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS harvest_pass_free_periods (
          customer_id uuid PRIMARY KEY,
          starts_at timestamptz NOT NULL DEFAULT now(),
          ends_at timestamptz NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("DROP TABLE IF EXISTS referrals")
    op.execute("DROP TABLE IF EXISTS referral_codes")

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS push_tokens (
          token text PRIMARY KEY,
          profile_id uuid NOT NULL,
          platform text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_settings (
          profile_id uuid PRIMARY KEY,
          push_enabled boolean NOT NULL DEFAULT true,
          email_enabled boolean NOT NULL DEFAULT true,
          sms_enabled boolean NOT NULL DEFAULT false,
          sms_consented_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notifications (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          profile_id uuid NOT NULL,
          kind text NOT NULL,
          title text NOT NULL,
          body text NOT NULL,
          data jsonb NOT NULL DEFAULT '{}'::jsonb,
          dedupe_key text UNIQUE,
          push_status text,
          email_status text,
          sms_status text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    op.execute("ALTER TABLE customer_profiles ADD COLUMN IF NOT EXISTS location_precision text")
    op.execute("ALTER TABLE farmer_profiles ADD COLUMN IF NOT EXISTS location_precision text")


def downgrade() -> None:
    op.execute("ALTER TABLE farmer_profiles DROP COLUMN IF EXISTS location_precision")
    op.execute("ALTER TABLE customer_profiles DROP COLUMN IF EXISTS location_precision")
    op.execute("DROP TABLE IF EXISTS notifications")
    op.execute("DROP TABLE IF EXISTS notification_settings")
    op.execute("DROP TABLE IF EXISTS push_tokens")
    op.execute("DROP TABLE IF EXISTS harvest_pass_free_periods")
    # referral_codes / referrals aren't recreated — re-run b4d9e7a2c1f8's
    # upgrade by hand if they're ever needed again.
