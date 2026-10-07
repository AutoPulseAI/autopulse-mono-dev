"""The customer refers back to a vehicle we already showed (PLAN_4 stream X3, added item).

"The silver one", "the second one you sent", "the Tacoma", "that one", "the 2022", "the one with fewer miles" were
treated as ordinary short replies. They are resolved here, in code, against the vehicles earlier replies named
(`conversation.shown_vehicles`, each kept with the fields it was shown with):

- colour ("the silver one"), make / model / trim words ("the Tacoma", "the XLE"), a model year ("the 2022"),
  combined when several are given ("the blue RAV4");
- an ordinal ("the second one you sent"), counted in the order the vehicles of our LAST reply that named any were
  shown - not while we're waiting for them to pick a visit time ("the second one" is then a time);
- "that one" / "this one" / "the one you sent": the single vehicle our last such reply named;
- a comparative only when the data supports it: fewer / more miles, newer / older (never "cheaper": the AI holds
  no price).

One match: that vehicle (Search stock re-reads it from the dealer's stock, so a sold one is said to be gone).
Several: `ambiguous`, and the reply asks which, naming them briefly. No cue or no match: nothing (None).
"""

import re
from dataclasses import dataclass, field
from typing import Any

_COLOURS = ("white", "black", "silver", "gray", "grey", "red", "blue", "green", "orange", "yellow", "brown",
            "beige", "gold", "purple", "maroon", "tan")
_COLOUR = re.compile(r"\b(" + "|".join(_COLOURS) + r")\b", re.IGNORECASE)
_ORDINALS = {"first": 0, "1st": 0, "second": 1, "2nd": 1, "third": 2, "3rd": 2, "last": -1}
_ORDINAL = re.compile(r"\bthe\s+(first|1st|second|2nd|third|3rd|last)\s+(?:one|vehicle|car|truck|suv|option)\b",
                      re.IGNORECASE)
_THAT_ONE = re.compile(r"\b(?:that|this)\s+(?:one|vehicle|car|truck|suv)\b|\bthe\s+one\s+you\s+(?:sent|showed|"
                       r"mentioned|texted|listed)\b|\bthe\s+same\s+one\b", re.IGNORECASE)
_YEAR = re.compile(r"\bthe\s+((?:19|20)\d{2})\b(?:\s+(?:one|model))?", re.IGNORECASE)
_FEWER_MILES = re.compile(r"\b(?:fewer|less|lower|lowest|least)\s+(?:miles|mileage)\b|\blow(?:er|est)?[- ]mileage\b",
                          re.IGNORECASE)
_MORE_MILES = re.compile(r"\b(?:more|higher|highest|most)\s+(?:miles|mileage)\b", re.IGNORECASE)
_NEWER = re.compile(r"\bthe\s+(?:newer|newest)\s+(?:one|model)?\b", re.IGNORECASE)
_OLDER = re.compile(r"\bthe\s+(?:older|oldest)\s+(?:one|model)?\b", re.IGNORECASE)
# A reference is "the <colour> ..." / "that one": a colour alone ("anything in blue?") while describing what they
# want isn't one.
_DEFINITE_COLOUR = re.compile(r"\b(?:the|that|this)\s+(?:[\w-]+\s+){0,2}?(" + "|".join(_COLOURS) + r")\b",
                              re.IGNORECASE)


@dataclass
class Reference:
    vin: str | None = None
    ambiguous: list[str] = field(default_factory=list)  # VINs, when more than one shown vehicle fits
    how: str = ""  # what matched, for the trace


def _norm_colour(value: Any) -> str:
    value = str(value or "").lower()
    return "gray" if value == "grey" else value


def _words(value: Any) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", str(value or "").lower()) if w]


def _named(text: str, vehicle: dict[str, Any], key: str) -> bool:
    """`the <model/make/trim>` in the text (whole words; "the Tacoma", "the RAV4 XLE")."""
    words = _words(vehicle.get(key))
    if not words:
        return False
    joined = r"[\s-]*".join(re.escape(w) for w in words)
    return bool(re.search(rf"\b(?:the|that|this)\s+(?:[\w-]+\s+){{0,3}}?{joined}\b", text, re.IGNORECASE))


def brief(vehicle: dict[str, Any]) -> str:
    """"the silver 2021 Toyota RAV4 LE" - only the record's own fields."""
    parts = [str(vehicle.get(k)) for k in ("exterior_color", "year", "make", "model", "trim") if vehicle.get(k)]
    return "the " + " ".join(parts) if parts else "that vehicle"


def resolve(text: str, shown: list[dict[str, Any]], *, awaiting_visit_pick: bool = False) -> Reference | None:
    """`shown`: the shown vehicles, oldest first, each {vin, turn, year, make, model, trim, exterior_color, miles}."""
    text = text or ""
    shown = [v for v in shown if v.get("vin")]
    if not shown or not text.strip():
        return None
    last_turn = max(int(v.get("turn") or 0) for v in shown)
    latest = [v for v in shown if int(v.get("turn") or 0) == last_turn]

    filters: list[tuple[str, Any]] = []
    if m := _DEFINITE_COLOUR.search(text):
        colour = _norm_colour(m.group(1))
        filters.append((f"colour {colour}", lambda v, c=colour: c in _norm_colour(v.get("exterior_color"))))
    if m := _YEAR.search(text):
        year = m.group(1)
        filters.append((f"year {year}", lambda v, y=year: str(v.get("year")) == y))
    for key in ("model", "trim", "make"):
        if any(_named(text, v, key) for v in shown):
            filters.append((key, lambda v, k=key: _named(text, v, k)))
    if filters:
        fits = [v for v in shown if all(test(v) for _, test in filters)]
        how = " + ".join(label for label, _ in filters)
        return _pick(fits, text, how)

    if not awaiting_visit_pick and (m := _ORDINAL.search(text)):
        index = _ORDINALS[m.group(1).lower()]
        if -len(latest) <= index < len(latest):
            return Reference(vin=latest[index]["vin"], how=f"the {m.group(1).lower()} one of our last reply")
        return None
    for pattern, key, lowest, how in ((_FEWER_MILES, "miles", True, "fewer miles"),
                                      (_MORE_MILES, "miles", False, "more miles"),
                                      (_NEWER, "year", False, "newer"), (_OLDER, "year", True, "older")):
        if pattern.search(text):
            return _compare(shown, key, lowest, how)
    if _THAT_ONE.search(text):
        if len(latest) == 1:
            return Reference(vin=latest[0]["vin"], how="the one vehicle our last reply named")
        return Reference(ambiguous=[v["vin"] for v in latest], how="'that one', but our last reply named several")
    return None


def _pick(fits: list[dict[str, Any]], text: str, how: str) -> Reference | None:
    if not fits:
        return None
    if len(fits) == 1:
        return Reference(vin=fits[0]["vin"], how=how)
    # Several fit ("the silver one" with two silver ones): a comparative in the same message may settle it.
    for pattern, key, lowest, label in ((_FEWER_MILES, "miles", True, "fewer miles"),
                                        (_MORE_MILES, "miles", False, "more miles"),
                                        (_NEWER, "year", False, "newer"), (_OLDER, "year", True, "older")):
        if pattern.search(text) and (settled := _compare(fits, key, lowest, f"{how} + {label}")) and settled.vin:
            return settled
    return Reference(ambiguous=[v["vin"] for v in fits], how=f"{how}: {len(fits)} shown vehicles fit")


def _compare(vehicles: list[dict[str, Any]], key: str, lowest: bool, how: str) -> Reference | None:
    """Only when every candidate has the value and one is strictly the lowest / highest."""
    if len(vehicles) < 2 or any(not isinstance(v.get(key), (int, float)) for v in vehicles):
        return None
    ordered = sorted(vehicles, key=lambda v: v[key], reverse=not lowest)
    if ordered[0][key] == ordered[1][key]:
        return Reference(ambiguous=[v["vin"] for v in ordered if v[key] == ordered[0][key]], how=f"{how}: a tie")
    return Reference(vin=ordered[0]["vin"], how=how)
