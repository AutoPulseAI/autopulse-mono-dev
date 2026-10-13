"""The buyer's order sequence, in the client's words (client, 12 Oct 2026 - Betsy: "dealers saying that many
customers are recently asking for buyer's orders to ensure accurate pricing. Can we set up a sequence for that?").

    Customer: Can you please send me a buyer's order for this car?
    AI: ready to take delivery today?            YES -> trading a vehicle?
    trading?        YES -> appraise first: today or tomorrow?                          (the sequence ends)
                    NO  -> planning to finance?
    finance?        YES -> credit application link                                     (the sequence ends)
                    NO  -> will there be a lien holder?
    lien holder?    YES -> lien holder name and address? a more competitive rate?      -> rate?
                    NO  -> driver's license, insurance ID, SSN; a quick call now?      -> call?
    rate?           YES -> credit application link                                     (the sequence ends)
    call?           YES -> escalate to sales (Dealership Action Required)              (the sequence ends)

Each step waits for a clear yes or no. Anything else - a question, a different subject - leaves the sequence and the
conversation carries on as usual (her email defines only the yes / no branches). Pure: the step is kept on the lead
state by the turn (agent/turn.py), and the text is placed by code like the other client scripts.
"""

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

ASKS = re.compile(r"\bbuyer'?s?\s+order\b|\bpurchase\s+order\b|\bbuyers?\s+agreement\b|\bbill\s+of\s+sale\b",
                  re.IGNORECASE)
_YES = re.compile(r"^\W*(yes|yeah|yep|yup|sure|correct|absolutely|definitely|of course|i am|i do|i will|we are|we do|"
                  r"ok(ay)?|y)\b", re.IGNORECASE)
_NO = re.compile(r"^\W*(no|nope|nah|not\s+(?:really|today|yet|now)|i'?m\s+not|i\s+don'?t|i\s+won'?t|n)\b",
                 re.IGNORECASE)
# A sequence nobody answered in this long is over.
TTL = timedelta(days=3)

DELIVERY, TRADE, FINANCE, LIEN, RATE, CALL = "delivery", "trade", "finance", "lien", "rate", "call"

START = "That is great; that must mean you are ready to buy today! Are you ready to take delivery today?"
_TEXT = {
    (DELIVERY, "yes"): (("We will be happy to help you with that! We will just need to cover a few items: Are you "
                        "trading a vehicle?"), TRADE),
    (TRADE, "yes"): (("Excellent! In order to provide you with an accurate buyer's order and because it is a legal "
                     "document, we must appraise your trade-in first. When are you available to come in to complete "
                     "this step: today or tomorrow?"), None),
    (TRADE, "no"): ("Are you planning to finance this vehicle?", FINANCE),
    (FINANCE, "yes"): (("Ok, I will need you to complete our credit application to ensure you qualify.{link} Please let "
                       "me know once this step is complete."), None),
    (FINANCE, "no"): (("Will you receive the funds from a lender? In many circumstances, we are required to list them as "
                      "a lien holder. Will there be a lien holder associated with this transaction?"), LIEN),
    (LIEN, "yes"): (("What is the lien holder name and address? Often, we can obtain a more competitive interest rate. "
                    "Would you like to explore that option?"), RATE),
    (LIEN, "no"): (("Great! In order to generate your purchase order, please provide me with a copy of your driver's "
                   "license and insurance ID card as well as your social security number. Each of these items must "
                   "appear on the purchase order. Can we get on a quick call right now to ensure all of your "
                   "information is secured?"), CALL),
    (RATE, "yes"): ("Here is our credit application:{link} Please let me know once this step is complete.", None),
    (CALL, "yes"): ("Perfect, I'm getting our sales manager to call you right now.", None),
}
ESCALATE_REASON = "Customer asked for a call to complete the buyer's order"
# The answers that need the dealership (her "call? YES -> Dealership Action Required"), the first step, and the yes / no
# workflows added in AI Studio ({key, asks, start, start_step}; their steps are "<key>:<step>" in _TEXT) - all
# replaced by the published versions when edited there (upsell_agent/ai_studio.py).
ESCALATE_AT = frozenset({(CALL, "yes")})
START_STEP = DELIVERY
FLOWS: list[dict[str, Any]] = []
# What an answer does besides (or instead of) a reply, set in AI Studio: {(step, answer): {"set_status": "...",
# "call_task": True, "escalate": True}}. An answer with no reply text leaves the conversation to the AI.
ACTIONS: dict[tuple[str, str], dict[str, Any]] = {}


@dataclass(frozen=True)
class Step:
    text: str
    next_step: str | None  # None: the sequence ends here
    escalates: bool = False
    flow: str | None = None  # a workflow added in AI Studio (None: the buyer's order)
    actions: dict[str, Any] | None = None  # set a status / create a call task (AI Studio)


def answer_of(text: str | None) -> str | None:
    said = (text or "").strip()
    if _NO.search(said):
        return "no"
    if _YES.search(said):
        return "yes"
    return None


def open_step(state: dict | None, now: datetime) -> str | None:
    record = (state or {}).get("buyers_order") or {}
    at = record.get("at")
    if not record.get("step") or not isinstance(at, datetime):
        return None
    from upsell_agent.agent.lifecycle import _aware
    return record["step"] if now - (_aware(at) or now) <= TTL else None


def plan(state: dict | None, text: str | None, now: datetime, *, credit_link: str | None) -> Step | None:
    """The reply for this message, or None when the sequence doesn't apply (the normal conversation carries on)."""
    step = open_step(state, now)
    if step:
        answer = answer_of(text)
        found = _TEXT.get((step, answer)) if answer else None
        if found:
            reply, nxt = found
            link = f" Here is a link: {credit_link}" if credit_link else ""
            if step == RATE:
                link = f" {credit_link}" if credit_link else " I'll send it right over."
            actions = ACTIONS.get((step, answer)) or {}
            return Step(reply.replace("{link}", link), nxt,
                        escalates=(step, answer) in ESCALATE_AT or bool(actions.get("escalate")),
                        flow=step.split(":", 1)[0] if ":" in step else None, actions=actions or None)
        if answer == "no" and step in (DELIVERY, RATE, CALL):
            return None  # her email has no "no" branch here: the conversation carries on toward the appointment
    if ASKS.search(text or ""):
        return Step(START, START_STEP)
    for flow in FLOWS:
        if flow["asks"].search(text or ""):
            return Step(flow["start"].replace("{link}", f" {credit_link}" if credit_link else ""), flow["start_step"],
                        flow=flow["key"])
    return None


def record(step: Step, now: datetime) -> dict[str, Any] | None:
    """What the lead state keeps after this step's reply went out (None: the sequence is over)."""
    return {"step": step.next_step, "at": now} if step.next_step else None
