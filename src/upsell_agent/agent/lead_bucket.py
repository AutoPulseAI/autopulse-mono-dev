"""Sales lead buckets (client blueprint §2 "Sales lead bucket routing", scope
Workflow 1 step 3; MASTER_PLAN_4 stream A1).

Every sales lead goes into one of three buckets by its source, before it
enters the workflow:

    credit   - Capital One, Chase, Carzing, DealerCentric, Credit Application,
               eUnifi, 700Credit
    trade_in - KBB, TrueCar SELL My Car, AccuTrade, CarGurus SELL My Car
    general  - CarGurus, AutoTrader, Edmunds, Cars.com, Facebook, Instagram,
               AutoWeb, CarsDirect, TrueCar (non-trade), and anything unknown

The lead's own comments are the fallback signal when the source isn't on the
lists. The source lists are config (BUCKET_SOURCES below): the blueprint
says "and others (to be added)".

"Bucket determines INTENT & LANGUAGE, not the workflow" (blueprint, "Bucket
rules & behavior"; client 26 Sep: "These cadences will apply to ALL new lead
buckets"): the bucket only feeds Compose the word-track emphasis. It never
changes the cadence, the asks or the visit offer.

Behaviour override (blueprint): when the customer's own replies clearly show
a different primary intent ("I just want to sell my car" on a credit lead),
`bucket` follows them and `original_bucket` is kept for reporting.

Service leads have no bucket (the blueprint's buckets are for SALES leads).

Demo hook (DEMO_BUCKET_KEYWORDS, default off): a brand-new conversation whose
first SMS is exactly CREDIT, TRADE or GENERAL (any case) is put in that
bucket, and the keyword is not treated as the customer's message.
"""

import re
from dataclasses import dataclass
from typing import Any, Literal

from upsell_agent import clock
from upsell_agent.agent.qualification import FactSource, LeadType
from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION, DealerScopedDatabase
from upsell_agent.slots.requirements import lead_type_for

Bucket = Literal["credit", "trade_in", "general"]
BUCKETS: tuple[Bucket, ...] = ("credit", "trade_in", "general")

# --- Config: the blueprint's source lists, checked in this order (first match wins) ---------------
#
# Trade-in comes first so "TrueCar SELL My Car" / "CarGurus SELL My Car" beat plain TrueCar / CarGurus.
BUCKET_SOURCES: list[tuple[Bucket, str]] = [
    ("trade_in", (r"sell\s*my\s*car|kbb|kelley\s*blue|accu-?trade|instant\s*(?:cash\s*)?offer|trade[\s_-]*in|"
                  r"appraisal|valuation")),
    ("credit", (r"capital\s*one|\bchase\b|carzing|dealer\s*centric|credit\s*app|e-?unifi|700\s*credit|"
                r"credit|financ|pre-?qual|pre-?approv")),
    ("general", (r"cargurus|autotrader|auto\s*trader|edmunds|cars\.?com|facebook|instagram|autoweb|"
                 r"cars\s*direct|carsdirect|truecar")),
]

# The lead's own words, when the source didn't decide it.
_TEXT_SIGNALS: list[tuple[Bucket, str]] = [
    ("trade_in", (r"sell\s+(?:my|our)\s+(?:car|truck|vehicle|suv)|trade[\s-]*in|trading\s+in|what'?s\s+my\s+"
                  r"(?:car|truck|vehicle)\s+worth|apprais|how\s+much\s+(?:is|would)\s+my")),
    ("credit", (r"\bcredit\b|financ|pre-?approv|pre-?qual|\bloan\b|bad\s+credit|down\s+payment|"
                r"monthly\s+payment")),
]

# A clear change of primary intent in the customer's own replies (blueprint "Behavior override rule").
# Deliberately strong phrases: mentioning a trade on a credit lead is normal, not a change of intent.
_OVERRIDE_SIGNALS: list[tuple[Bucket, str]] = [
    ("trade_in", (r"(?:just|only|really)\s+(?:want|looking)\s+to\s+sell|want\s+to\s+sell\s+(?:my|our)\s+"
                  r"(?:car|truck|vehicle|suv)|(?:would|will)\s+you\s+buy\s+my\s+(?:car|truck|vehicle)|"
                  r"how\s+much\s+(?:would|will|can)\s+you\s+(?:give|offer|pay)\s+(?:me\s+)?for\s+my|"
                  r"what'?s\s+my\s+(?:car|truck|vehicle)\s+worth")),
    ("credit", (r"(?:can|could)\s+i\s+(?:get|be)\s+(?:approved|financed|pre-?approved)|my\s+credit\s+"
                r"(?:is|isn'?t|score)|bad\s+credit|no\s+credit|need\s+(?:financing|a\s+loan)|"
                r"(?:get|getting)\s+pre-?approved")),
    ("general", (r"(?:is|are)\s+(?:it|they|this|that)\s+still\s+available|do\s+you\s+(?:still\s+)?have\s+"
                 r"(?:it|the|a|any)\b|can\s+i\s+(?:test\s*drive|see)\s+(?:it|the)")),
]

# Word-track emphasis, word for word from the scope's Workflow 1 table (blueprint §2).
WORD_TRACKS: dict[Bucket, str] = {
    "credit": ("Financing options, pre-approval, payment structure, required information, how an appointment "
               "helps clarify real options. Never promise approval."),
    "trade_in": ("Value, appraisal, condition, payoff and equity, an accurate in-person number. Aggressively "
                 "collect trade data. Never state a trade value."),
    "general": ("Availability, pricing, features, condition, history, alternatives, trade, financing, and "
                "whatever the lead comments show matters most."),
}
INTENTS: dict[Bucket, str] = {
    "credit": "Focused on approval, payment options, financing, or credit-related next steps.",
    "trade_in": "Wants to sell or trade a vehicle.",
    "general": "Shopping, comparing, asking vehicle-specific questions, or exploring purchase options.",
}
# Blueprint "New layer: vehicle type filter" (scope Workflow 1 step 4).
VEHICLE_TYPE_TRACKS: dict[str, str] = {
    "new": ("New model/trim requested, OEM incentives, lease/finance programs, rebates, model/trim alternatives, "
            "incoming inventory, dealer trades, upgrade/loyalty."),
    "used": ("Specific VIN/stock number, exact availability, mileage/condition/history, CARFAX/history when "
             "available, similar used inventory, price changes/drops, alternatives if the unit sells."),
}

# The demo keyword (exactly the whole first message, any case).
_DEMO_KEYWORDS: dict[str, Bucket] = {"credit": "credit", "trade": "trade_in", "trade-in": "trade_in",
                                     "tradein": "trade_in", "general": "general"}
# The lead type a demo bucket implies, so an SMS-started lead (source "sms" → general) isn't asked
# "are you buying, trading in or booking service?" right after the tester chose.
_DEMO_LEAD_TYPE = {"credit": LeadType.SALES, "trade_in": LeadType.TRADE_IN, "general": LeadType.SALES}


@dataclass(frozen=True)
class Classification:
    bucket: Bucket
    method: Literal["source", "lead_text", "default", "demo_keyword"]
    why: str


def _source_text(lead: dict | None) -> str:
    lead = lead or {}
    data = lead.get("data") or {}
    return " ".join(str(v or "") for v in (lead.get("source"), lead.get("lead_source"), data.get("source"),
                                           data.get("provider"))).lower()


def _lead_text(lead: dict | None) -> str:
    lead = lead or {}
    return str((lead.get("data") or {}).get("comments") or lead.get("comments") or "")


def classify(lead: dict | None) -> Classification | None:
    """The bucket for a new lead: its source, else its own comments, else
    general. None for a service lead (buckets are for sales leads)."""
    if lead_type_for(lead) == LeadType.SERVICE:
        return None
    source = _source_text(lead)
    for bucket, pattern in BUCKET_SOURCES:
        if source.strip() and (m := re.search(pattern, source, re.IGNORECASE)):
            return Classification(bucket, "source", f"lead source {source.strip()!r} matched {m.group(0)!r}")
    text = _lead_text(lead)
    for bucket, pattern in _TEXT_SIGNALS:
        if m := re.search(pattern, text, re.IGNORECASE):
            return Classification(bucket, "lead_text", f"source not on the lists; the lead's comments say "
                                                       f"{m.group(0)!r}")
    return Classification("general", "default", "source not on the lists and nothing in the comments: general")


def demo_keyword(text: str | None) -> Bucket | None:
    return _DEMO_KEYWORDS.get(re.sub(r"[\s.!]+$", "", (text or "").strip()).lower())


def override_from_reply(text: str | None, current: str | None) -> tuple[Bucket, str] | None:
    """(bucket, matched words) when the customer's reply clearly shows a
    different primary intent than `current`; None otherwise."""
    for bucket, pattern in _OVERRIDE_SIGNALS:
        if (m := re.search(pattern, text or "", re.IGNORECASE)) and bucket != current:
            return bucket, m.group(0)
    return None


def _record(classification: Classification, now) -> dict[str, Any]:
    return {"bucket": classification.bucket, "original_bucket": classification.bucket,
            "bucket_method": classification.method, "bucket_why": classification.why, "bucket_at": now,
            "bucket_history": [{"bucket": classification.bucket, "at": now, "method": classification.method,
                                "why": classification.why}]}


async def apply_to_turn(db: DealerScopedDatabase, *, lead_id: str | None, customer_id: str | None,
                        lead: dict | None, lead_state: dict | None, trigger: str, inbound_text: str,
                        demo_keywords: bool, source_message_id: str | None = None) -> tuple[dict | None, str]:
    """Called by agent/turn.py before the graph runs. Sets the bucket on a
    lead's first turn, applies the demo keyword or a behaviour override,
    and returns (the lead state, the text the turn should answer)."""
    if not lead_id:
        return lead_state, inbound_text
    states = db.collection(AI_LEAD_STATE_COLLECTION)
    now = clock.now()
    update: dict[str, Any] = {}

    keyword = demo_keyword(inbound_text) if demo_keywords and trigger == "lead_created" else None
    if keyword and lead_type_for(lead) != LeadType.SERVICE:
        update = _record(Classification(keyword, "demo_keyword", f"demo: the first message was {inbound_text!r}"),
                         now)
        inbound_text = ""  # the keyword picks the bucket; it isn't the customer's question
        if lead_type_for(lead) == LeadType.GENERAL and customer_id:
            from upsell_agent.slots.store import save_fact
            await save_fact(db, customer_id=customer_id, lead_id=lead_id, path="interest.lead_type",
                            value=_DEMO_LEAD_TYPE[keyword].value, source=FactSource.CUSTOMER_STATED,
                            quote=demo_keyword_quote(keyword), confidence=1.0, now=now)
    elif not (lead_state or {}).get("original_bucket"):
        if classification := classify(lead):
            update = _record(classification, now)
    elif trigger == "inbound_message" and (change := override_from_reply(inbound_text, lead_state.get("bucket"))):
        bucket, words = change
        why = f"the customer's reply shows a different intent ({words!r}); original bucket kept for reporting"
        update = {"bucket": bucket, "bucket_method": "behaviour_override", "bucket_why": why, "bucket_at": now}
        await states.update_one({"lead_id": lead_id}, {"$push": {"bucket_history": {
            "bucket": bucket, "at": now, "method": "behaviour_override", "why": why,
            "message_id": source_message_id}}})

    if update:
        # The same insert defaults as agent/turn.py's _save_origin, for a turn run before the handlers made one.
        await states.update_one({"lead_id": lead_id}, {"$set": update, "$setOnInsert": {
            "lead_id": lead_id, "created_at": now, "status": "active"}}, upsert=True)
        lead_state = {**(lead_state or {}), **update}
    return lead_state, inbound_text


def demo_keyword_quote(bucket: Bucket) -> str:
    return {"credit": "CREDIT", "trade_in": "TRADE", "general": "GENERAL"}[bucket]


def vehicle_type(profile_values: dict[str, Any]) -> str | None:
    value = profile_values.get("interest.new_or_used")
    return value if value in VEHICLE_TYPE_TRACKS else None


def for_compose(lead_state: dict | None, profile_values: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """What Compose (and the offline model) get: the current bucket, its
    intent and word-track emphasis, the original bucket, and the vehicle
    type's emphasis when the customer has said new or used."""
    bucket = (lead_state or {}).get("bucket")
    if bucket not in WORD_TRACKS:
        return None
    kind = vehicle_type(profile_values or {})
    return {"name": bucket, "original": lead_state.get("original_bucket"), "intent": INTENTS[bucket],
            "emphasis": WORD_TRACKS[bucket], "vehicle_type": kind,
            "vehicle_type_emphasis": VEHICLE_TYPE_TRACKS[kind] if kind else None}


def for_api(lead_state: dict | None) -> dict[str, Any] | None:
    state = lead_state or {}
    if not state.get("original_bucket"):
        return None
    at = state.get("bucket_at")
    return {"bucket": state.get("bucket"), "original_bucket": state.get("original_bucket"),
            "method": state.get("bucket_method"), "why": state.get("bucket_why"),
            "at": at.isoformat() if hasattr(at, "isoformat") else at,
            "overridden": state.get("bucket") != state.get("original_bucket"),
            "history": [{**h, "at": h["at"].isoformat() if hasattr(h.get("at"), "isoformat") else h.get("at")}
                        for h in state.get("bucket_history") or []]}
