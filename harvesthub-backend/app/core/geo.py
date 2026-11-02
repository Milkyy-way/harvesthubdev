import math

KM_PER_MILE = 1.609344
# How far from a customer a farm shows up when they browse: the farm list,
# spotlight, harvest picks and group deals. A farm's page itself stays open, for
# past orders and deals already joined.
MAX_BROWSE_MILES = 50
MAX_BROWSE_KM = MAX_BROWSE_MILES * KM_PER_MILE


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0088  # mean Earth radius, km
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))
