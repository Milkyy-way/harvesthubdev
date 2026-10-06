# HarvestHub API — production image. Works on any host that runs a
# Dockerfile (Render, Railway, Fly.io, Google Cloud Run, ...). Configure it
# with environment variables (see .env.example); the host provides $PORT.
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY alembic ./alembic
COPY alembic.ini .

RUN useradd --create-home --uid 10001 harvesthub
USER harvesthub

EXPOSE 8000
# --proxy-headers: the host's load balancer terminates HTTPS in front of us.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
