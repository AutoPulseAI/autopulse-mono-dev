"""Touch outcome tracking (client blueprint box 5: "Track every touch: message
strategy, lead source, timing, customer data, response/no response,
appointment/no appointment"; PLAN_4 stream L item 1).

**One row per outbound AI touch** in `ai_touches`, keyed by `touch_id` (the
turn / step id the send's idempotency key starts with), so the text and the
email of one touch are one row with `channels: ["sms", "email"]` and a re-run
never counts twice. Recorded for the first reply, every cadence touch, the
dated next step, the after-hours morning message, the visit follow-up, the
appointment steps and the SOLD PENDING / ownership lifecycle messages. A reply
to something the customer just sent is not a touch.

Each row carries its context - dealer, lead, bucket (and the original one),
lead source, new/used, the touch kind, theme/angle and day, the wording and
send-time variants it was given, the channels, the dealer-local send hour,
weekday and time band - and then its outcome, filled in later from events
that already exist:

    replied_at / reply_hours / replied_24h / replied_72h / meaningful_reply
                                the customer's next message (events/handlers.py record_inbound)
    appointment_at / appointment_7d   the lead entered Appointment Set (agent/lifecycle.py apply)
    showed_at                   the lead reached Sales Visit after that appointment
    opted_out_at / opted_out_channel  a STOP / opt-out phrase (channels/consent.py)

**Attribution is last touch:** an outcome goes to the lead's most recent touch
sent before it, and only once - a reply after a touch that already has one is
the conversation carrying on, not a response to an older touch. An outcome
older than its window (7 days for an appointment) isn't credited.

Never raises: a tracking failure must never stop a message or a turn.
"""

import logging
import re
from datetime import UTC, datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TOUCHES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
)

logger = logging.getLogger(__name__)

REPLY_WINDOW_SHORT = timedelta(hours=24)
REPLY_WINDOW = timedelta(hours=72)
APPOINTMENT_WINDOW = timedelta(days=7)
SENT_STATUSES = ("sent", "duplicate")

# The touch kinds (what the report groups by). Turn triggers map onto them; scheduler steps pass their own.
KIND_FIRST_REPLY = "first_reply"
KIND_CADENCE = "cadence"
TRIGGER_KINDS = {"lead_created": KIND_FIRST_REPLY, "cadence_touch": KIND_CADENCE, "next_action": "next_action",
                 "resume_at_opening": "morning_message", "visit_followup": "visit_followup"}
KIND_LABELS = {
    KIND_FIRST_REPLY: "First reply", KIND_CADENCE: "Follow-up touch (Days 1-90)",
    "next_action": "Dated follow-up the customer asked for", "morning_message": "After-hours morning message",
    "visit_followup": "Fresh visit offer", "appointment": "Appointment message",
    "sold_pending_touch": "Sold pending touch", "post_delivery_checkin": "Post-delivery check-in",
    "ownership_anniversary": "Ownership anniversary", "birthday": "Birthday", "service_outreach": "Service outreach",
}

# Dealer-local send hour -> band (the context the learning and the report use).
TIME_BANDS = (("morning", 0, 12), ("afternoon", 12, 17), ("evening", 17, 24))
TIME_BAND_LABELS = {"morning": "Morning (before noon)", "afternoon": "Afternoon (noon-5pm)",
                    "evening": "Evening (after 5pm)"}
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

_STOP = re.compile(r"^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*[.!]*\s*$", re.IGNORECASE)
_SOURCE_CLEAN = re.compile(r"[^a-z0-9 .&+-]+")


def aware(value: Any) -> datetime | None:
    """Mongo hands datetimes back naive (UTC)."""
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo else value.replace(tzinfo=UTC)


def time_band(hour: int) -> str:
    return next(name for name, start, end in TIME_BANDS if start <= hour < end)


def lead_source(lead: dict | None) -> str:
    """The lead's source as a short, stable label ("cargurus", "capital one"), "unknown" when none."""
    lead = lead or {}
    data = lead.get("data") or {}
    raw = next((str(v) for v in (lead.get("source"), lead.get("lead_source"), data.get("source"),
                                 data.get("provider")) if v), "")
    label = " ".join(_SOURCE_CLEAN.sub(" ", raw.lower()).split())[:60]
    return label or "unknown"


def touch_kind(trigger: str) -> str | None:
    """The touch kind of an AI turn, or None when the turn answers the customer (not a touch)."""
    return TRIGGER_KINDS.get(trigger)


def context_of(lead: dict | None, lead_state: dict | None) -> dict[str, Any]:
    state = lead_state or {}
    return {"bucket": state.get("bucket") or "none", "original_bucket": state.get("original_bucket"),
            "source": lead_source(lead), "vehicle_type": state.get("vehicle_type") or "unknown",
            "original_vehicle_type": state.get("original_vehicle_type")}


async def record_touch(db: DealerScopedDatabase, *, touch_id: str, lead_id: str | None, customer_id: str | None,
                       kind: str, outcomes: list[Any], theme: str | None = None, theme_label: str | None = None,
                       touch: dict[str, Any] | None = None, lead: dict | None = None,
                       lead_state: dict | None = None, at: datetime | None = None) -> bool:
    """Records one touch (or adds a channel to it). `outcomes`: the SendOutcomes of its sends; only the ones that
    actually went out count, so a suppressed / held / shadow send isn't a touch. `touch`: the cadence plan's own
    dict (touch number, day, theme, the variants it was given). Returns whether anything was recorded."""
    if not lead_id:
        return False
    channels = [o.channel for o in outcomes if o is not None and getattr(o, "status", None) in SENT_STATUSES]
    if not channels:
        return False
    try:
        from upsell_agent.integrations.dealer_profile import dealer_profile

        now = at or clock.now()
        if lead is None:
            lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
        if lead_state is None:
            lead_state = await db.collection(AI_LEAD_STATE_COLLECTION).find_one({"lead_id": lead_id})
        profile = await dealer_profile(db.dealer_id)
        local = now.astimezone(profile.tz)
        plan = touch or {}
        row = {
            "touch_id": touch_id, "lead_id": lead_id, "customer_id": customer_id, "kind": kind,
            "theme": theme or plan.get("theme"), "theme_label": theme_label or plan.get("theme_label"),
            "touch_number": plan.get("touch_number"), "day": plan.get("day"),
            "variant": plan.get("variant"), "time_variant": plan.get("time_variant"),
            "choice": plan.get("choice"), "price_drop_vin": (plan.get("price_drop") or {}).get("vin"),
            **context_of(lead, lead_state),
            "sent_at": now, "local_hour": local.hour, "weekday": WEEKDAYS[local.weekday()],
            "time_band": time_band(local.hour),
            "replied_at": None, "replied_24h": False, "replied_72h": False, "meaningful_reply": False,
            "appointment_at": None, "appointment_7d": False, "showed_at": None, "opted_out_at": None,
        }
        await db.collection(AI_TOUCHES_COLLECTION).update_one(
            {"touch_id": touch_id}, {"$setOnInsert": row, "$addToSet": {"channels": {"$each": channels}}},
            upsert=True)
        return True
    except Exception:  # noqa: BLE001 - tracking never stops a message
        logger.exception("Couldn't record touch %s for lead %s", touch_id, lead_id)
        return False


async def _latest_touch(db: DealerScopedDatabase, flt: dict[str, Any], at: datetime,
                        since: datetime | None = None) -> dict | None:
    window: dict[str, Any] = {"$lte": at, **({"$gte": since} if since else {})}
    rows = await db.collection(AI_TOUCHES_COLLECTION).find(
        {**flt, "sent_at": window}).sort("sent_at", -1).to_list(1)
    return rows[0] if rows else None


def is_meaningful(text: str | None) -> bool:
    """The client's meaningful reply (agent/lifecycle.py), and not a bare STOP."""
    from upsell_agent.agent.lifecycle import is_meaningful_reply

    return is_meaningful_reply(text)[0] and not _STOP.match(text or "")


async def on_customer_reply(db: DealerScopedDatabase, lead_id: str | None, *, text: str | None,
                            at: datetime | None = None) -> dict | None:
    """The customer wrote back: credit the lead's latest touch, once. A later meaningful message inside the
    72-hour window upgrades a first reply that wasn't (an emoji, then a real answer)."""
    if not lead_id:
        return None
    try:
        at = aware(at) or clock.now()
        touch = await _latest_touch(db, {"lead_id": lead_id}, at)
        if touch is None:
            return None
        sent = aware(touch.get("sent_at"))
        delta = at - sent
        meaningful = is_meaningful(text)
        touches = db.collection(AI_TOUCHES_COLLECTION)
        if touch.get("replied_at"):
            if meaningful and not touch.get("meaningful_reply") and delta <= REPLY_WINDOW:
                await touches.update_one({"_id": touch["_id"]}, {"$set": {"meaningful_reply": True}})
            return None
        fields = {"replied_at": at, "reply_hours": round(delta.total_seconds() / 3600, 2),
                  "replied_24h": delta <= REPLY_WINDOW_SHORT, "replied_72h": delta <= REPLY_WINDOW,
                  "meaningful_reply": meaningful and delta <= REPLY_WINDOW}
        await touches.update_one({"_id": touch["_id"], "replied_at": None}, {"$set": fields})
        return {**touch, **fields}
    except Exception:  # noqa: BLE001
        logger.exception("Couldn't attribute a reply on lead %s", lead_id)
        return None


async def on_stage_change(db: DealerScopedDatabase, lead_id: str | None, stage: str, *,
                          at: datetime | None = None) -> None:
    """Appointment Set credits the latest touch of the last 7 days; Sales Visit marks the touch that got the
    appointment as showed; Opted Out marks the latest touch."""
    from upsell_agent.agent.lifecycle import Stage

    if not lead_id:
        return
    try:
        at = aware(at) or clock.now()
        touches = db.collection(AI_TOUCHES_COLLECTION)
        if stage == Stage.APPOINTMENT_SET:
            touch = await _latest_touch(db, {"lead_id": lead_id}, at, since=at - APPOINTMENT_WINDOW)
            if touch and not touch.get("appointment_at"):
                await touches.update_one({"_id": touch["_id"]},
                                         {"$set": {"appointment_at": at, "appointment_7d": True}})
        elif stage == Stage.SALES_VISIT:
            rows = await touches.find({"lead_id": lead_id, "appointment_at": {"$ne": None}, "showed_at": None}
                                      ).sort("appointment_at", -1).to_list(1)
            if rows:
                await touches.update_one({"_id": rows[0]["_id"]}, {"$set": {"showed_at": at}})
        elif stage == Stage.OPTED_OUT:
            await on_opt_out(db, lead_id=lead_id, customer_id=None, channel="all", at=at)
    except Exception:  # noqa: BLE001
        logger.exception("Couldn't attribute stage %s on lead %s", stage, lead_id)


async def on_opt_out(db: DealerScopedDatabase, *, lead_id: str | None, customer_id: str | None, channel: str,
                     at: datetime | None = None) -> None:
    """A STOP or an opt-out phrase: the latest touch (by lead, else by customer) is marked, once."""
    flt = {"lead_id": lead_id} if lead_id else {"customer_id": customer_id} if customer_id else None
    if flt is None:
        return
    try:
        at = aware(at) or clock.now()
        touch = await _latest_touch(db, flt, at)
        if touch and not touch.get("opted_out_at"):
            await db.collection(AI_TOUCHES_COLLECTION).update_one(
                {"_id": touch["_id"]}, {"$set": {"opted_out_at": at, "opted_out_channel": channel}})
    except Exception:  # noqa: BLE001
        logger.exception("Couldn't attribute an opt-out on lead %s / customer %s", lead_id, customer_id)
