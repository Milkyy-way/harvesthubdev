// Saved places to browse nearby farms from: harvesthub-backend/app/customers/places.py.
// Home is the address on the customer's profile, and isn't in this list.
export type SavedPlace = { id: string; name: string; address_line: string };

export type PlacesOverview = {
  active_place_id: string | null;
  home_city: string | null;
  max_places: number;
  places: SavedPlace[];
};
