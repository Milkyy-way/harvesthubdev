"""add harvest pass memberships and referrals

Revision ID: b4d9e7a2c1f8
Revises: a7c4e2f9b1d3
Create Date: 2026-10-17 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b4d9e7a2c1f8'
down_revision: Union[str, Sequence[str], None] = 'a7c4e2f9b1d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror the tables and column added by 0028_harvest_pass.sql. Same raw
    IF NOT EXISTS discipline as every prior revision — the foreign keys,
    check constraints, the one-live-membership unique index and RLS live
    only in the Supabase SQL migration."""
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS stripe_customers (
          profile_id uuid PRIMARY KEY,
          stripe_customer_id text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS memberships (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id uuid NOT NULL,
          plan text NOT NULL,
          interval_months integer NOT NULL,
          price_amount numeric(10, 2) NOT NULL,
          stripe_subscription_id text NOT NULL UNIQUE,
          status text NOT NULL,
          trial_end timestamptz,
          current_period_end timestamptz,
          cancel_at_period_end boolean NOT NULL DEFAULT false,
          canceled_at timestamptz,
          ended_at timestamptz,
          card_brand text,
          card_last4 text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS referral_codes (
          customer_id uuid PRIMARY KEY,
          code text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS referrals (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          referrer_id uuid NOT NULL,
          referred_id uuid NOT NULL UNIQUE,
          code text NOT NULL,
          membership_id uuid,
          status text NOT NULL DEFAULT 'pending',
          reward_amount numeric(10, 2),
          stripe_balance_transaction_id text UNIQUE,
          rewarded_at timestamptz,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS member_savings numeric(10, 2) NOT NULL DEFAULT 0"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS member_savings")
    op.execute("DROP TABLE IF EXISTS referrals")
    op.execute("DROP TABLE IF EXISTS referral_codes")
    op.execute("DROP TABLE IF EXISTS memberships")
    op.execute("DROP TABLE IF EXISTS stripe_customers")
