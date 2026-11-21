from datetime import datetime
from sqlalchemy import Column, Numeric, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import JSONB, UUID
from app.core.database import Base


class ProblemReport(Base):
    """A customer's "Report a problem" on one farm's part of an order (0042):
    up to 24 hours after pickup or delivery, or after "not picked".
    HarvestHub decides (scripts/problems.py); nothing waits on the farm."""

    __tablename__ = "problem_reports"

    id = Column(UUID(as_uuid=True), primary_key=True)
    store_order_id = Column(UUID(as_uuid=True), nullable=False)
    customer_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(String, nullable=False)
    details = Column(String, nullable=True)
    items = Column(JSONB, nullable=False, default=list)  # [{"item_id", "product_name", "quantity"}]
    status = Column(String, nullable=False, default="open")  # 'open' | 'refunded' | 'declined' | 'handled'
    refund_amount = Column(Numeric(10, 2), nullable=True)
    decision_note = Column(String, nullable=True)
    decided_at = Column(TIMESTAMP(timezone=True), nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
    updated_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
