from pydantic import BaseModel


class AddressSuggestionOut(BaseModel):
    place_id: str
    main_text: str  # "1600 Pennsylvania Avenue Northwest"
    secondary_text: str  # "Washington, DC, USA"


class AddressSuggestionsOut(BaseModel):
    suggestions: list[AddressSuggestionOut]


class AddressDetailsOut(BaseModel):
    street: str
    city: str
    state: str  # two letters
    zip: str  # five digits
