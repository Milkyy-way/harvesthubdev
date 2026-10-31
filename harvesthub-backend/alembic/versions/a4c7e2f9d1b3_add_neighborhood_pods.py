"""add neighborhood pods

Revision ID: a4c7e2f9d1b3
Revises: e5b3d8a1c7f2
Create Date: 2026-10-31 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'a4c7e2f9d1b3'
down_revision: Union[str, Sequence[str], None] = 'e5b3d8a1c7f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Mirror 0035_neighborhood_pods.sql's tables and columns (its RLS and
    erase_user_data live only in the Supabase SQL migration)."""
    op.execute("""
        CREATE TABLE IF NOT EXISTS pods (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            host_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            name text NOT NULL,
            status text NOT NULL DEFAULT 'draft',
            delivery_weekday smallint NOT NULL,
            drop_kind text,
            address_street text,
            address_city text,
            address_state text,
            address_zip text,
            latitude double precision,
            longitude double precision,
            location_precision text,
            geocoded_at timestamptz,
            access_notes text,
            shelter_note text,
            permission_attested_at timestamptz,
            drop_version integer NOT NULL DEFAULT 1,
            reapprove_by timestamptz,
            drop_locked_date date,
            first_invite_at timestamptz,
            activated_at timestamptz,
            paused_at timestamptz,
            grace_ends_at timestamptz,
            ended_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS pod_members (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            pod_id uuid NOT NULL REFERENCES pods (id) ON DELETE CASCADE,
            customer_id uuid NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
            delivery_weekday smallint NOT NULL,
            status text NOT NULL DEFAULT 'active',
            approved_drop_version integer NOT NULL DEFAULT 1,
            leave_at timestamptz,
            leave_reason text,
            joined_at timestamptz NOT NULL DEFAULT now(),
            left_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS pod_invites (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            pod_id uuid NOT NULL REFERENCES pods (id) ON DELETE CASCADE,
            code text NOT NULL UNIQUE,
            label text,
            status text NOT NULL DEFAULT 'sent',
            invitee_id uuid REFERENCES profiles (id) ON DELETE SET NULL,
            expires_at timestamptz NOT NULL,
            responded_at timestamptz,
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    op.execute("ALTER TABLE farm_delivery_settings ADD COLUMN IF NOT EXISTS offers_pod_delivery boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE farm_delivery_settings ADD COLUMN IF NOT EXISTS pod_delivery_fee numeric(10, 2) NOT NULL DEFAULT 5.00")
    op.execute("ALTER TABLE delivery_stops ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES pods (id) ON DELETE SET NULL")
    op.execute("ALTER TABLE delivery_stops ADD COLUMN IF NOT EXISTS pod_drop_version integer")
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS pod_id uuid REFERENCES pods (id) ON DELETE SET NULL")
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS pod_drop_version integer")
    op.execute("ALTER TABLE store_orders ADD COLUMN IF NOT EXISTS pod_full_fee numeric(10, 2)")
    op.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_setup_intent_id text")
    op.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS stripe_payment_method_id text")
    op.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS charge_attempts integer NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE payments ADD COLUMN IF NOT EXISTS last_charge_attempt_at timestamptz")
    op.execute("ALTER TABLE products ADD COLUMN IF NOT EXISTS keep_cold boolean NOT NULL DEFAULT false")
    op.execute("ALTER TABLE store_order_items ADD COLUMN IF NOT EXISTS keep_cold boolean NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE store_order_items DROP COLUMN IF EXISTS keep_cold")
    op.execute("ALTER TABLE products DROP COLUMN IF EXISTS keep_cold")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS last_charge_attempt_at")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS charge_attempts")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS stripe_payment_method_id")
    op.execute("ALTER TABLE payments DROP COLUMN IF EXISTS stripe_setup_intent_id")
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS pod_full_fee")
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS pod_drop_version")
    op.execute("ALTER TABLE store_orders DROP COLUMN IF EXISTS pod_id")
    op.execute("ALTER TABLE delivery_stops DROP COLUMN IF EXISTS pod_drop_version")
    op.execute("ALTER TABLE delivery_stops DROP COLUMN IF EXISTS pod_id")
    op.execute("ALTER TABLE farm_delivery_settings DROP COLUMN IF EXISTS pod_delivery_fee")
    op.execute("ALTER TABLE farm_delivery_settings DROP COLUMN IF EXISTS offers_pod_delivery")
    op.execute("DROP TABLE IF EXISTS pod_invites")
    op.execute("DROP TABLE IF EXISTS pod_members")
    op.execute("DROP TABLE IF EXISTS pods")
