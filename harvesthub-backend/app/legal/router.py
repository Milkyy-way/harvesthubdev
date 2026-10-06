from functools import lru_cache
from pathlib import Path
from string import Template

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

from app.core.config import settings

# Public pages Google Play asks for: a privacy policy URL and an account
# deletion URL (plus the terms). Served by the API so they're live wherever
# the backend is deployed; the app's Legal screen links here. The text is
# in app/legal/pages/*.html — $company, $support_email and $effective_date
# come from settings.
router = APIRouter(include_in_schema=False)

_PAGES = Path(__file__).parent / "pages"
_TITLES = {"privacy": "Privacy Policy", "terms": "Terms of Service", "delete-account": "Delete your account"}


@lru_cache
def _render(name: str) -> str:
    values = {
        "company": settings.COMPANY_NAME,
        "support_email": settings.SUPPORT_EMAIL,
        "effective_date": settings.LEGAL_EFFECTIVE_DATE,
    }
    content = Template((_PAGES / f"{name}.html").read_text(encoding="utf-8")).safe_substitute(values)
    layout = Template((_PAGES / "layout.html").read_text(encoding="utf-8"))
    return layout.safe_substitute(values, title=_TITLES[name], content=content)


@router.get("/privacy", response_class=HTMLResponse)
def privacy_policy():
    return _render("privacy")


@router.get("/terms", response_class=HTMLResponse)
def terms_of_service():
    return _render("terms")


@router.get("/delete-account", response_class=HTMLResponse)
def delete_account_page():
    return _render("delete-account")
