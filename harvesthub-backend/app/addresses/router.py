from fastapi import APIRouter, HTTPException, Path, Query, Request, status

from app.addresses import service
from app.addresses.schemas import AddressDetailsOut, AddressSuggestionsOut

# Address suggestions for the app's address fields (components/
# AddressSearchField.tsx). No sign-in required — email sign-up asks for the
# address before the account exists — so each caller's IP is rate-limited.
router = APIRouter(prefix="/addresses", tags=["addresses"])

_suggest_limiter = service.RateLimiter(limit=60, window_seconds=60)
_details_limiter = service.RateLimiter(limit=20, window_seconds=60)

_SESSION = r"^[A-Za-z0-9_-]{8,36}$"


def _check_rate(request: Request, limiter: service.RateLimiter) -> None:
    ip = request.client.host if request.client else "unknown"
    if not limiter.allow(ip):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many address lookups. Try again in a minute.")


@router.get("/suggestions", response_model=AddressSuggestionsOut)
def address_suggestions(
    request: Request,
    q: str = Query(..., min_length=3, max_length=200),
    session: str = Query(..., pattern=_SESSION),
):
    _check_rate(request, _suggest_limiter)
    return {"suggestions": service.suggest(q.strip(), session)}


@router.get("/details/{place_id}", response_model=AddressDetailsOut)
def address_details(
    request: Request,
    place_id: str = Path(..., pattern=r"^[A-Za-z0-9_-]{10,300}$"),
    session: str = Query(..., pattern=_SESSION),
):
    _check_rate(request, _details_limiter)
    return service.details(place_id, session)
