from datetime import datetime
from sqlalchemy import Column, Date, Float, Integer, SmallInteger, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class Pod(Base):
    """A group of neighbors sharing a drop point and delivery day (0035)."""

    __tablename__ = "pods"

    id = Column(UUID(as_uuid=True), primary_key=True)
    host_id = Column(UUID(as_uuid=True), nullable=False)
    name = Column(String, nullable=False)
    status = Column(String, nullable=False, default="draft")  # draft | pending | active | paused | expired | dissolved
    delivery_weekday = Column(SmallInteger, nullable=False)  # 0 = Monday, like datetime.weekday()

    # The drop point: empty while a new host still has to choose one, and
    # cleared once an ended pod has no open orders.
    drop_kind = Column(String, nullable=True)  # 'home' | 'neutral'
    address_street = Column(String, nullable=True)
    address_city = Column(String, nullable=True)
    address_state = Column(String, nullable=True)
    address_zip = Column(String, nullable=True)
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    location_precision = Column(String, nullable=True)
    geocoded_at = Column(TIMESTAMP(timezone=True), nullable=True)
    access_notes = Column(String, nullable=True)  # host and driver only
    shelter_note = Column(String, nullable=True)
    permission_attested_at = Column(TIMESTAMP(timezone=True), nullable=True)

    drop_version = Column(Integer, nullable=False, default=1)
    reapprove_by = Column(TIMESTAMP(timezone=True), nullable=True)
    # Everyone ordered for this delivery date: the drop point is fixed until
    # those orders are done.
    drop_locked_date = Column(Date, nullable=True)

    first_invite_at = Column(TIMESTAMP(timezone=True), nullable=True)
    activated_at = Column(TIMESTAMP(timezone=True), nullable=True)
    paused_at = Column(TIMESTAMP(timezone=True), nullable=True)
    grace_ends_at = Column(TIMESTAMP(timezone=True), nullable=True)
    ended_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class PodMember(Base):
    __tablename__ = "pod_members"

    id = Column(UUID(as_uuid=True), primary_key=True)
    pod_id = Column(UUID(as_uuid=True), nullable=False)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    delivery_weekday = Column(SmallInteger, nullable=False)  # copied from the pod, for 0035's unique index
    status = Column(String, nullable=False, default="active")  # 'active' | 'left'
    approved_drop_version = Column(Integer, nullable=False, default=1)
    # A departure that's been decided: takes effect once this time has passed
    # and their open order has been delivered.
    leave_at = Column(TIMESTAMP(timezone=True), nullable=True)
    leave_reason = Column(String, nullable=True)  # 'left' | 'lapsed' | 'revoked' | 'no_reapproval'
    joined_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    left_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)


class PodInvite(Base):
    __tablename__ = "pod_invites"

    id = Column(UUID(as_uuid=True), primary_key=True)
    pod_id = Column(UUID(as_uuid=True), nullable=False)
    code = Column(String, nullable=False)  # what goes in the shared link
    label = Column(String, nullable=True)  # the host's own note: "Sam next door"
    status = Column(String, nullable=False, default="sent")  # sent | accepted | declined | expired | revoked
    invitee_id = Column(UUID(as_uuid=True), nullable=True)  # who answered
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    responded_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
