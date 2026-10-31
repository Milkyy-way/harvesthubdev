import re
from functools import lru_cache
from pathlib import Path
from string import Template

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.core.config import settings

# Public pages Google Play asks for: a privacy policy URL and an account
# deletion URL (plus the terms). Served by the API so they're live wherever
# the backend is deployed; the app's Legal screen links here. The text is
# in app/legal/pages/*.html — $company, $support_email and $effective_date
# come from settings.
router = APIRouter(include_in_schema=False)

_PAGES = Path(__file__).parent / "pages"
_TITLES = {
    "privacy": "Privacy Policy",
    "terms": "Terms of Service",
    "delete-account": "Delete your account",
    "get-app": "Get the app",
    "pod-invite": "You're invited to a Neighborhood Pod",
}


@lru_cache
def _render(name: str) -> str:
    values = {
        "company": settings.COMPANY_NAME,
        "support_email": settings.SUPPORT_EMAIL,
        "effective_date": settings.LEGAL_EFFECTIVE_DATE,
        "android_url": settings.ANDROID_APP_URL,
        "ios_line": (
            f'<a href="{settings.IOS_APP_URL}">Get the iPhone app</a>' if settings.IOS_APP_URL else "Coming soon."
        ),
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


# The one link the app shares ("Invite friends"): it works for whoever opens
# it. Android phones go to Google Play; iPhones go to the
# App Store once IOS_APP_URL is set; anything else (a computer, or an iPhone
# before the iOS app exists) gets a page with both.
@router.get("/app")
def get_the_app(request: Request):
    agent = request.headers.get("user-agent", "")
    if "Android" in agent:
        return RedirectResponse(settings.ANDROID_APP_URL, status_code=302)
    if settings.IOS_APP_URL and any(device in agent for device in ("iPhone", "iPad", "iPod")):
        return RedirectResponse(settings.IOS_APP_URL, status_code=302)
    return HTMLResponse(_render("get-app"))


# A Neighborhood Pod invite link. Says nothing about the pod itself — that's
# for the app's accept screen, for someone signed in. Opens the app if it's
# installed; otherwise they install it, sign up and type the code in.
@router.get("/invite/{code}", response_class=HTMLResponse)
def pod_invite(code: str):
    if not re.fullmatch(r"[A-Z2-9]{8}", code):
        raise HTTPException(status_code=404, detail="Not Found")
    return Template(_render("pod-invite")).safe_substitute(code=code)


# iOS Universal Links: tells iPhones that invite links belong to the app, so a
# tap opens it directly, with no browser. Apple fetches this file itself, so it
# must stay at this exact path with no redirect. The app's side is
# ios.associatedDomains in app.config.ts.
@router.get("/.well-known/apple-app-site-association")
def apple_app_site_association():
    if not settings.APPLE_TEAM_ID:
        raise HTTPException(status_code=404, detail="Not Found")
    bundles = ("com.harvesthubmarket.app", "com.harvesthubmarket.app.dev")
    return JSONResponse(
        {
            "applinks": {
                "details": [
                    {
                        "appIDs": [f"{settings.APPLE_TEAM_ID}.{bundle}" for bundle in bundles],
                        "components": [{"/": "/invite/*", "comment": "Neighborhood Pod invites"}],
                    }
                ]
            }
        }
    )
