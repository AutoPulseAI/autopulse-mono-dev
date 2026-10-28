"""Two leads from one customer within 30 days (client, 12 Oct 2026 - Betsy):

    "If 2+ leads come in for the same customer within 30 days, the AI should ask 'Hello again, [customer name],
    thank you for inquiring about our [vehicle year, make, model]. Are you comparing models, or are you in the
    market for more than one vehicle?' If the customer is in the market for one vehicle, the AI can close lost the
    original lead. If the customer is interested in both vehicles, keep both leads open and proceed towards setting
    an appointment."

The new lead is linked to the customer's open lead as before (agent/duplicates.py); this module asks the question
on that conversation and acts on the answer:
    one vehicle ("just one", "comparing")   -> the ORIGINAL lead closes as Closed - Lost; the new lead becomes the
                                               working lead (duplicates.release_linked)
    both ("both", "more than one", "two")   -> the new lead is unlinked and runs its own workflow; both stay open
Anything else is answered as a normal message and the question stays open for QUESTION_TTL.
Pure wording and classification here; events/handlers.py does the sending and the moves.
"""

import re
from datetime import datetime, timedelta
from typing import Any

WINDOW = timedelta(days=30)
QUESTION_TTL = timedelta(days=14)

_BOTH = re.compile(r"\b(both|two|2 (cars|vehicles)|more than one|several|multiple|all of them|each|also want|"
                   r"interested in (both|the two)|for (my|the) (wife|husband|son|daughter|kid|family))\b", re.IGNORECASE)
_ONE = re.compile(r"\b(just one|only one|one (car|vehicle|of them)|comparing|compare|deciding|either|"
                  r"choose|pick one|not both|just (the|a) (one|single))\b", re.IGNORECASE)


def vehicle_label(lead: dict | None) -> str | None:
    lead = lead or {}
    data = lead.get("data") or {}
    # The lead's own fields, else the lead email's vehicle the CRM keeps in data.vehicle (a dict since 12 Oct 2026 -
    # read field by field: printing the dict sent "{'year': ... 'vin': ...}" to a customer).
    vehicle = data.get("vehicle") if isinstance(data.get("vehicle"), dict) else {}
    from upsell_agent.agent.cadence import clean_vehicle
    parts = [str(lead.get(k) or vehicle.get(k) or "").strip() for k in ("year", "make", "model")]
    if named := clean_vehicle(" ".join(p for p in parts if p)):
        return named
    text = data.get("vehicle") if isinstance(data.get("vehicle"), str) else lead.get("vehicle")
    return clean_vehicle(str(text or ""))


def question_text(first_name: str | None, vehicle: str | None) -> dict[str, str]:
    who = f", {first_name}" if first_name else ""
    about = f"our {vehicle}" if vehicle else "another vehicle"
    body = (f"Hello again{who}, thank you for inquiring about {about}. Are you comparing models, or are you in the "
            f"market for more than one vehicle?")
    built = {"sms_text": body, "email_subject": "Thanks for your inquiry", "email_body": f"{body}\n\nThank you"}
    from upsell_agent import ai_studio  # the wording published in AI Studio, when edited there
    return ai_studio.render(ai_studio.message("messages", "repeat_lead"),
                            {"first_name": first_name, "vehicle": vehicle}, built) or built


def within_window(primary_started: datetime | None, now: datetime) -> bool:
    return primary_started is not None and now - primary_started <= WINDOW


# Quincy Mack, 20 Oct 2026: "I've got an offer for 14,300 / Just wanna compare and what works best for me" (an offer
# for his Sentra elsewhere) was read as "one vehicle" and the lead was closed as Closed - Lost. A message about an
# offer, a payoff or their own car isn't an answer to "comparing models?".
_ABOUT_THEIR_CAR = re.compile(r"\b(offer|offered|payoff|pay off|owe|trade|my car|my truck|appraisal|kbb|carmax|"
                              r"carvana|\$?\d{1,3}(?:,\d{3})+|\d+k)\b", re.IGNORECASE)


def classify(text: str | None) -> str | None:
    """'both', 'one', or None when the message doesn't answer the question."""
    said = text or ""
    if _ABOUT_THEIR_CAR.search(said):
        return None
    if re.search(r"\b(not both|just one|only one|only (want|need) one)\b", said, re.IGNORECASE):
        return "one"
    if _BOTH.search(said):
        return "both"
    if _ONE.search(said):
        return "one"
    return None


def open_question(state: dict | None, now: datetime) -> dict[str, Any] | None:
    q = (state or {}).get("multi_vehicle_question") or {}
    asked = q.get("asked_at")
    if not q.get("new_lead_id") or q.get("answered") or not isinstance(asked, datetime):
        return None
    from upsell_agent.agent.lifecycle import _aware
    if now - (_aware(asked) or now) > QUESTION_TTL:
        return None
    return q
