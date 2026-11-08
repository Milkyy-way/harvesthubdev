import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.customers import places as customer_places
from app.customers import service as customers_service
from app.deals import closing as deals_closing
from app.delivery import service as delivery_service
from app.farmers import service as farmers_service
from app.notifications import jobs as notification_jobs
from app.orders import service as orders_service
from app.pods import service as pods_service

# Periodic work, run by Cloud Scheduler every 15 minutes (LAUNCH_ANDROID.md
# step 5) — not the app. Authenticated by a shared secret (CRON_SECRET), and
# off entirely when that isn't set. Every task is safe to repeat.
router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


@router.post("/jobs/run")
def run_jobs(x_cron_secret: str | None = Header(None), db: Session = Depends(get_db)):
    if not settings.CRON_SECRET or not x_cron_secret or not hmac.compare_digest(x_cron_secret, settings.CRON_SECRET):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return {
        **notification_jobs.run(db),
        # Neighborhood Pods: invites expiring, grace periods, departures.
        **pods_service.run_jobs(db),
        # Group deals: opening to members, then everyone; charging at the deadline.
        **deals_closing.run(db),
        # Refunds Stripe didn't finish at once: how they ended.
        "refunds_settled": orders_service.sync_pending_refunds(db),
        # Google's coordinates may only be kept 30 days (app/core/geocoding.py).
        "homes_regeocoded": customers_service.refresh_stale_locations(db),
        "places_regeocoded": customer_places.refresh_stale(db),
        "farms_regeocoded": farmers_service.refresh_stale_locations(db),
        # Photos of customers' doorsteps are only kept 30 days.
        "delivery_photos_deleted": delivery_service.purge_old_photos(db),
    }
