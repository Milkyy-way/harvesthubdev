from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import settings

# A small pool per server instance: a host like Cloud Run can run several
# instances at once, and each one's connections count against Supabase's
# pooler limit (about 15 on the free plan). 3 + 2 overflow per instance, with
# the host capped at 2 instances, stays well inside it. Requests beyond that
# wait briefly for a free connection instead of failing.
engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, pool_size=3, max_overflow=2, pool_recycle=300)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()