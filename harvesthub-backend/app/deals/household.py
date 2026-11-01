"""One join per household per deal, and a household is an address plus its
apartment (decided with the user 2026-11-01). Spelling differences shouldn't
make one home look like two, so the address is reduced to a key."""
import re

_WORDS = {
    "street": "st",
    "avenue": "ave",
    "road": "rd",
    "drive": "dr",
    "boulevard": "blvd",
    "lane": "ln",
    "court": "ct",
    "place": "pl",
    "terrace": "ter",
    "circle": "cir",
    "highway": "hwy",
    "parkway": "pkwy",
    "north": "n",
    "south": "s",
    "east": "e",
    "west": "w",
    "northeast": "ne",
    "northwest": "nw",
    "southeast": "se",
    "southwest": "sw",
}
_UNIT_LABEL = r"(?:apartment|apt|unit|suite|ste|#)"
_UNIT_IN_STREET = re.compile(rf"\s{_UNIT_LABEL}\s*([a-z0-9-]+)$")
_UNIT_PREFIX = re.compile(rf"^{_UNIT_LABEL}\s*")


def _clean(text: str | None) -> str:
    return " ".join(re.sub(r"[^a-z0-9#-]+", " ", (text or "").lower()).split())


def _unit(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _UNIT_PREFIX.sub("", text))


def household_key(street: str | None, unit: str | None, zip_code: str | None) -> str:
    cleaned = _clean(street)
    cleaned_unit = _clean(unit)
    # Older addresses, or ones typed by hand, can have the apartment in the street.
    if not cleaned_unit:
        match = _UNIT_IN_STREET.search(cleaned)
        if match:
            cleaned_unit = match.group(1)
            cleaned = cleaned[: match.start()]
    words = " ".join(_WORDS.get(word, word) for word in cleaned.split())
    return f"{words}|{_unit(cleaned_unit)}|{(zip_code or '').strip()[:5]}"
