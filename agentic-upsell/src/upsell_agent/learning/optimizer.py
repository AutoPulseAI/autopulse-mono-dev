"""Engagement learning for the cadence (PLAN_4 stream L items 2-3; blueprint
box 5: "AI learns which combinations generate the highest engagement and uses
successful approaches more frequently ... evaluated IN CONTEXT (by source,
intent, time of day) ... Do not blindly repeat the same message"; Omnichannel
PDF §4: "choose the most relevant unused angle").

Called by scheduler/followups.py `plan_cadence_touch` once agent/cadence.py has
planned the touch. Three decisions, each through learning/bandit.py:

1. **Send time** (Days 2-90): morning or afternoon (learning/variants.py).
   An even random split until both have MIN_SAMPLES settled touches, then
   Thompson sampling. Off with SEND_TIME_AB=false.
2. **Angle** (Days 8-90 only; Days 2-7 follow the client's fixed order).
   Candidates: the extended angles not used yet, else all but the last two
   used ("do not blindly repeat"). An angle whose facts aren't available is
   never a candidate: "verified price change" needs a verified price drop on
   a vehicle this lead is about (learning/price_watch.py). Until every
   candidate has MIN_SAMPLES, the standard order (cadence.pick_theme) - so a
   new dealer behaves as before.
3. **Wording** within the chosen theme (learning/variants.py), Days 2-90:
   an even split, then Thompson sampling. Not for the name nudge (mandated
   text) or a price-drop announcement (its own instruction).

**The reward** is "the customer replied within 72 hours" (the blueprint's
"Goal of every touch: GET THE CUSTOMER TO RESPOND"), counted only on settled
touches (sent more than 72 hours ago) of the last LEARNING_DAYS.

**Context:** the counts are looked up from the most specific context that
has enough data: bucket + lead source + new/used + time band, then bucket +
new/used, then bucket, then all of the dealer's leads; the platform-wide
counts for the same context are the prior (learning/bandit.py).

The random draws are seeded from the dealer, lead, cadence instance and touch
number, so re-planning the same touch gives the same answer.
"""

import logging
import random
import time as monotonic_time
from dataclasses import replace
from datetime import datetime, time, timedelta
from typing import Any

from upsell_agent.agent import cadence
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import (
    AI_TOUCHES_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    get_db,
)
from upsell_agent.learning import bandit, price_watch, variants
from upsell_agent.learning.touches import KIND_CADENCE, REPLY_WINDOW, context_of, time_band
from upsell_agent.tools.inventory_tool import get_inventory_source

logger = logging.getLogger(__name__)

LEARNING_DAYS = 180
RECENT_NOT_REPEATED = 2
PLATFORM_CACHE_S = 600.0

# The context levels, most specific first: (label, the fields that must match).
LEVELS: list[tuple[str, tuple[str, ...]]] = [
    ("leads like this one (bucket, source, new/used, time of day)", ("bucket", "source", "vehicle_type", "time_band")),
    ("same bucket and new/used", ("bucket", "vehicle_type")),
    ("same bucket", ("bucket",)),
    ("all leads", ()),
]
_GROUP_FIELDS = ("bucket", "source", "vehicle_type", "time_band")

_platform_cache: dict[tuple, tuple[float, list[dict]]] = {}


def clear_cache() -> None:
    _platform_cache.clear()


def _pipeline(option_field: str, now: datetime, theme: str | None) -> list[dict[str, Any]]:
    match: dict[str, Any] = {"kind": KIND_CADENCE, "sent_at": {"$gte": now - timedelta(days=LEARNING_DAYS),
                                                               "$lte": now - REPLY_WINDOW},
                             option_field: {"$ne": None}}
    if theme:
        match["theme"] = theme
    return [{"$match": match},
            {"$group": {"_id": {"option": f"${option_field}", **{f: f"${f}" for f in _GROUP_FIELDS}},
                        "n": {"$sum": 1},
                        "wins": {"$sum": {"$cond": [{"$eq": ["$replied_72h", True]}, 1, 0]}}}}]


async def _counts(db: DealerScopedDatabase, option_field: str, now: datetime,
                  theme: str | None = None) -> tuple[list[dict], list[dict]]:
    """(this dealer's groups, the platform's groups) of settled cadence touches by option and context."""
    pipeline = _pipeline(option_field, now, theme)
    dealer = await db.collection(AI_TOUCHES_COLLECTION).aggregate(pipeline).to_list(None)
    key = (option_field, theme, now.replace(minute=0, second=0, microsecond=0))
    cached = _platform_cache.get(key)
    if cached and cached[0] > monotonic_time.monotonic():
        platform = cached[1]
    else:
        # Cross-dealer by design: only counts leave the query, and only as the prior.
        platform = await get_db()[AI_TOUCHES_COLLECTION].aggregate(pipeline).to_list(None)
        _platform_cache[key] = (monotonic_time.monotonic() + PLATFORM_CACHE_S, platform)
    return dealer, platform


def levels_for(dealer: list[dict], platform: list[dict], context: dict[str, Any],
               skip: tuple[str, ...] = ()) -> list[tuple[str, dict[str, tuple[bandit.ArmStats, bandit.ArmStats]]]]:
    """Per context level, each option's (dealer, platform) stats. `skip`: context fields not to match on
    (the send-time test doesn't split by the time band it is choosing)."""
    out = []
    seen_fields: set[tuple[str, ...]] = set()
    for label, fields in LEVELS:
        fields = tuple(f for f in fields if f not in skip)
        if fields in seen_fields:
            continue
        seen_fields.add(fields)
        stats: dict[str, tuple[bandit.ArmStats, bandit.ArmStats]] = {}
        for which, rows in ((0, dealer), (1, platform)):
            for row in rows:
                group = row["_id"]
                if any(group.get(f) != context.get(f) for f in fields):
                    continue
                pair = stats.setdefault(group["option"], (bandit.ArmStats(), bandit.ArmStats()))
                pair[which].n += int(row["n"])
                pair[which].wins += int(row["wins"])
        out.append((label, stats))
    return out


def _rng(db: DealerScopedDatabase, lead_id: str, state: cadence.CadenceState, touch_number: int,
         purpose: str) -> random.Random:
    started = state.started_at.isoformat() if isinstance(state.started_at, datetime) else ""
    return random.Random(f"{db.dealer_id}:{lead_id}:{started}:{touch_number}:{purpose}")


def angle_candidates(used: list[str], exclude: frozenset[str], day: int | None = None) -> list[str]:
    themes = [t.id for t in cadence.themes_for_day(day) if t.id not in exclude]
    unused = [t for t in themes if t not in used]
    if unused:
        return unused
    recent = set(used[-RECENT_NOT_REPEATED:])
    return [t for t in themes if t not in recent] or themes


async def choose_for_touch(db: DealerScopedDatabase, planned: cadence.PlannedTouch, *, lead_id: str,
                           state: cadence.CadenceState, lead: dict | None, lead_state: dict | None, tz,
                           now: datetime, learning: bool = True, send_time_ab: bool = True
                           ) -> tuple[cadence.PlannedTouch, dict[str, Any]]:
    """The planned touch with its learned angle and send time, and what to store on the touch (variant,
    time variant, the instruction Compose gets, any price drop, and why each choice was made)."""
    if not planned.scheduled or planned.theme is None or planned.theme is cadence.NAME_NUDGE:
        return planned, {}
    context = context_of(lead, lead_state)
    extra: dict[str, Any] = {"choice": {}}
    due = planned.due_at

    # 1. Send time.
    if send_time_ab:
        dealer, platform = await _counts(db, "time_variant", now)
        options = list(variants.SEND_TIMES)
        pick = bandit.choose(options, levels_for(dealer, platform, context, skip=("time_band",)),
                             _rng(db, lead_id, state, planned.touch_number, "time"))
        local = due.astimezone(tz)
        due = datetime.combine(local.date(), time(variants.SEND_TIMES[pick.option]), tzinfo=tz)
        extra["time_variant"] = pick.option
        extra["choice"]["send_time"] = {"option": pick.option, "method": pick.method, "why": pick.why}
    context = {**context, "time_band": time_band(due.astimezone(tz).hour)}

    # 2. Angle (Days 8-90).
    theme = planned.theme
    drop = None
    if planned.touch_number not in cadence.FIXED_DAYS:
        drop = await price_watch.drop_for_lead(db, lead, lead_state, now)
        exclude = frozenset() if drop else frozenset({cadence.PRICE_CHANGE.id})
        default = cadence.pick_theme(planned.touch_number, state.themes_used, exclude, day=planned.day)
        candidates = angle_candidates(state.themes_used, exclude, day=planned.day)
        if default.id not in candidates:
            candidates.append(default.id)
        if learning:
            dealer, platform = await _counts(db, "theme", now)
            pick = bandit.choose(candidates, levels_for(dealer, platform, context),
                                 _rng(db, lead_id, state, planned.touch_number, "angle"), default=default.id)
        else:
            pick = bandit.Choice(default.id, "default", "learning is off: the standard order")
        theme = cadence.BY_ID[pick.option]
        extra["choice"]["angle"] = {"option": pick.option, "method": pick.method, "why": pick.why,
                                    "candidates": candidates,
                                    "price_drop": "a verified price drop is available" if drop else
                                    "no verified price drop, so the price angle isn't a candidate"}

    # 3. Wording within the theme.
    if theme is cadence.PRICE_CHANGE and drop:
        extra["price_drop"] = price_watch.for_touch(drop)
        extra["instruction"] = price_watch.touch_instruction(drop)
        extra["variant"] = "price_drop"
    elif learning and (options := variants.wording_options(theme.id)):
        dealer, platform = await _counts(db, "variant", now, theme=theme.id)
        pick = bandit.choose(options, levels_for(dealer, platform, context),
                             _rng(db, lead_id, state, planned.touch_number, "wording"))
        extra["variant"] = pick.option
        extra["instruction"] = variants.instruction(theme.id, pick.option)
        extra["choice"]["wording"] = {"option": pick.option, "method": pick.method, "why": pick.why}
    planned = replace(planned, theme=theme, due_at=due,
                      why=planned.why if theme is planned.theme else
                      f"Touch {planned.touch_number} on day {planned.day} of the cadence: {theme.label.lower()}.")
    return planned, extra


def touch_dict(planned: cadence.PlannedTouch, extra: dict[str, Any]) -> dict[str, Any]:
    """The `touch` stored on the scheduled record (and copied to `pending_touch` when it fires)."""
    out = planned.as_dict()
    if extra.get("instruction"):
        out["instruction"] = extra["instruction"]
    for key in ("variant", "time_variant", "price_drop", "choice"):
        if extra.get(key):
            out[key] = extra[key]
    return out


async def plan(db: DealerScopedDatabase, planned: cadence.PlannedTouch, *, lead_id: str,
               state: cadence.CadenceState, lead: dict | None, lead_state: dict | None, tz, now: datetime
               ) -> tuple[cadence.PlannedTouch, dict[str, Any]]:
    """scheduler/followups.py's entry point: the planned touch (its due time may have moved) and the touch dict
    to store, with the learned choices. Never fails the planning: on any error, today's plan."""
    settings = get_settings()
    try:
        if lead is None:
            lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": as_object_id(lead_id)})
        learned, extra = await choose_for_touch(db, planned, lead_id=lead_id, state=state, lead=lead,
                                                lead_state=lead_state, tz=tz, now=now,
                                                learning=settings.learning_enabled,
                                                send_time_ab=settings.send_time_ab)
    except Exception:
        logger.exception("Learning failed for lead %s; using the standard plan", lead_id)
        learned, extra = planned, {}
    return learned, touch_dict(learned, extra)


async def recheck_price_drop(db: DealerScopedDatabase, touch: dict[str, Any], settings: Any = None) -> dict[str, Any]:
    """When the touch fires: a price-drop touch re-reads the vehicle fresh. If the drop no longer holds at
    that price, the touch keeps its angle but loses the price (the angle's own no-price wording)."""
    drop = touch.get("price_drop")
    if not drop:
        return touch
    fresh = await price_watch.reverify(db, drop, get_inventory_source(settings or get_settings()))
    if fresh:
        return {**touch, "price_drop": price_watch.for_touch(fresh), "price_checked": True}
    out = {k: v for k, v in touch.items() if k != "price_drop"}
    return {**out, "instruction": cadence.PRICE_CHANGE.instruction, "variant": "a",
            "price_drop_lapsed": f"the drop on {drop.get('vin')} no longer holds at ${drop.get('price'):,}"}
