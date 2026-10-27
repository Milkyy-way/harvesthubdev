"""The marketplace's local time — America/New_York, for the DC/MD/VA launch
market. Farms' delivery windows are wall-clock times in it ("Fri 4–7 PM"),
and messages show dates in it. Needs the tzdata package (requirements.txt):
neither Windows nor the slim server image ships a time zone database.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("America/New_York")


def to_local(value: datetime) -> datetime:
    return value.astimezone(LOCAL_TZ)


def window_label(starts_at: datetime, ends_at: datetime) -> str:
    """'Fri, Nov 6 · 4–7 PM' (or '9:30 AM–12 PM' when the halves differ)."""
    start, end = to_local(starts_at), to_local(ends_at)

    def clock(t: datetime, with_period: bool) -> str:
        hour = t.hour % 12 or 12
        text = f"{hour}:{t.minute:02d}" if t.minute else f"{hour}"
        return f"{text} {'AM' if t.hour < 12 else 'PM'}" if with_period else text

    same_period = (start.hour < 12) == (end.hour < 12)
    times = f"{clock(start, not same_period)}–{clock(end, True)}"
    return f"{start:%a}, {start:%b} {start.day} · {times}"
