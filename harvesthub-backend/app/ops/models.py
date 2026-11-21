from datetime import datetime
from sqlalchemy import Column, String, TIMESTAMP
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


class OpsAlert(Base):
    """An email to HarvestHub itself (0042): a dispute, a refund made outside
    the app, a problem report, the daily check. Each dedupe_key is sent once."""

    __tablename__ = "ops_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True)
    kind = Column(String, nullable=False)
    dedupe_key = Column(String, nullable=False, unique=True)
    subject = Column(String, nullable=False)
    body = Column(String, nullable=False)
    email_status = Column(String, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), default=datetime.utcnow)
