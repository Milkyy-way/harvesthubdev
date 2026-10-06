"""Server-side calls to Supabase's Auth admin and Storage APIs, made with
the service-role key (settings.SUPABASE_SERVICE_ROLE_KEY). The rest of the
backend talks to Postgres directly; only account deletion needs these,
because auth users and Storage files can't be deleted from SQL."""
import requests

from app.core.config import settings

_LIST_PAGE = 1000
_TIMEOUT = 15


class SupabaseAdminError(Exception):
    pass


def is_configured() -> bool:
    return bool(settings.SUPABASE_SERVICE_ROLE_KEY)


def _headers() -> dict:
    key = settings.SUPABASE_SERVICE_ROLE_KEY
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def _check(resp: requests.Response, what: str) -> None:
    if resp.status_code >= 400:
        raise SupabaseAdminError(f"{what} failed: HTTP {resp.status_code} {resp.text[:200]}")


def list_storage_paths(bucket: str, folder: str) -> list[str]:
    """Every file under `folder` in `bucket`, including subfolders (Storage
    lists one level at a time; entries with no id are folders)."""
    paths: list[str] = []
    pending = [folder.strip("/")]
    while pending:
        current = pending.pop()
        offset = 0
        while True:
            resp = requests.post(
                f"{settings.SUPABASE_URL}/storage/v1/object/list/{bucket}",
                headers=_headers(),
                json={"prefix": current, "limit": _LIST_PAGE, "offset": offset},
                timeout=_TIMEOUT,
            )
            _check(resp, f"Listing {bucket}/{current}")
            entries = resp.json()
            for entry in entries:
                path = f"{current}/{entry['name']}"
                if entry.get("id") is None:
                    pending.append(path)
                else:
                    paths.append(path)
            if len(entries) < _LIST_PAGE:
                break
            offset += _LIST_PAGE
    return paths


def delete_storage_paths(bucket: str, paths: list[str]) -> None:
    for start in range(0, len(paths), _LIST_PAGE):
        resp = requests.delete(
            f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}",
            headers=_headers(),
            json={"prefixes": paths[start : start + _LIST_PAGE]},
            timeout=_TIMEOUT,
        )
        _check(resp, f"Deleting files in {bucket}")


def delete_auth_user(user_id: str) -> None:
    """Deletes the auth user. 0027's on_auth_user_deleted trigger then
    erases (or anonymizes) their data in public, in the same transaction —
    if that fails, the whole delete is rolled back and this raises."""
    resp = requests.delete(
        f"{settings.SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers=_headers(),
        timeout=_TIMEOUT,
    )
    if resp.status_code == 404:
        return  # already gone
    _check(resp, "Deleting the auth user")
