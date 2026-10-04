"""The check before a staff call task is shown (MASTER_PLAN_3 C2 item 3,
Omnichannel PDF §2; architecture §15 decisions 177-183).

A human call task is not an AI call (AI voice stays off, engine.py rule 1):
a person phones. It still follows the contact rules:

1. **A phone to call:** the lead's or customer's phone, skipping a number
   marked invalid (C6). None left: BLOCK.
2. **Voice opt-out:** "don't call me" or a do-not-contact request: BLOCK.
3. **DND:** the dealer's own do-not-contact status on the lead: BLOCK.
4. **Time:** 8:00-21:00 in the customer's own time zone(s) (the transactional
   window, the same hours the law gives a person calling) AND inside the
   dealer's opening hours, which stand in for the agents' work schedule (the
   platform has no per-agent schedule), and inside the customer's state's
   own live-call row (MASTER_PLAN_4 F1, compliance/state_hours.py). Outside
   them: HOLD until the next moment all of them allow it.

Every decision is added to the compliance log (channel `voice`, purpose
`human_call`).
"""

from datetime import datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.channels import consent
from upsell_agent.compliance import engine, state_hours
from upsell_agent.integrations.dealer_profile import dealer_profile
from upsell_agent.integrations.mongodb import (
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    dealer_scoped_db,
)

CALL_WINDOW = engine.TRANSACTIONAL_WINDOW


async def can_call(*, dealer_id: str, customer_id: str | None, lead_id: str, at: datetime | None = None,
                   request_id: str | None = None, record: bool = True) -> engine.Decision:
    db = dealer_scoped_db(dealer_id)
    at = engine._aware(at or clock.now())
    lead = await engine._find(db, PLATFORM_LEADS_COLLECTION, lead_id)
    if not customer_id and lead and lead.get("customer_id"):
        customer_id = str(lead["customer_id"])
    customer = await engine._find(db, PLATFORM_CUSTOMERS_COLLECTION, customer_id)
    checks: list[dict] = []

    def check(rule: str, passed: bool, detail: str) -> None:
        checks.append({"rule": rule, "passed": passed, "detail": detail})

    async def done(decision: engine.Decision) -> engine.Decision:
        decision.checks = checks
        if record:
            decision.log_id = await engine._log(
                db, decision, customer_id=customer_id, lead_id=lead_id, channel="voice", purpose="human_call",
                is_reply=False, at=at, to=phone, source="call_task", request_id=request_id, campaign=False)
        return decision

    phone = await consent.usable_recipient(db, lead, customer, "sms")
    if not phone:
        check("phone", False, "no valid phone on the lead or customer record")
        return await done(engine.Decision("BLOCK", "no valid phone to call", "no_phone"))
    check("phone", True, f"call {phone}")

    if await consent.is_opted_out(db, customer_id, "voice", phone):
        check("opt_out", False, "the customer asked not to be called")
        return await done(engine.Decision("BLOCK", "the customer opted out of calls", "opted_out"))
    check("opt_out", True, "not opted out of calls")

    if engine._is_dnd(lead):
        check("do_not_contact", False, "staff set the lead to DND")
        return await done(engine.Decision("BLOCK", "the lead is on the dealer's do-not-contact list", "do_not_contact"))
    check("do_not_contact", True, "not on the dealer's do-not-contact list")

    zone = await engine.customer_zone(db, customer_id, phone)
    profile = await dealer_profile(dealer_id)
    rules = state_hours.rules_for(state_hours.zone_states(zone))
    # PLAN_4 stream X1 item 7: FL / OK / MD "3 calls per 24 hours": the staff calls already made and the
    # marketing texts we sent count together.
    earliest = at
    if caps := state_hours.caps(rules):
        recent = sorted(await engine.calls_recently(db, customer_id, at)
                        + await engine._marketing_sms_sent_recently(db, customer_id, phone, at))
        for count, period in caps:
            inside = [r for r in recent if r > at - period]
            if len(inside) >= count:
                earliest = max(earliest, inside[-count] + period)
        check("state_frequency", earliest == at, f"{len(recent)} calls and marketing texts in the last 24 hours "
                                                 f"(the state's cap: {caps[0][0]})")
    if earliest > at:
        until = state_hours.next_allowed(earliest, zone.zones, rules, profile, extra_window=CALL_WINDOW)
        if until is None:
            return await done(engine.Decision("BLOCK", "the state's call cap, and no calling time after it",
                                              "no_allowed_time", zone=zone.as_dict()))
        return await done(engine.Decision("HOLD", "the state's cap of calls and texts in 24 hours", "held",
                                          until=until, zone=zone.as_dict()))
    # MASTER_PLAN_4 F1: the client's Table 1 is literally the states' live-call windows, so a person's
    # call follows the customer's state's row too (Sunday and holiday bans, later starts), inside 8:00-21:00.
    ok_customer = engine.in_window(at, zone.zones, CALL_WINDOW) and state_hours.allowed(at, zone.zones, rules)
    ok_dealer = engine.dealer_open(at, profile)
    window = f"{CALL_WINDOW[0]:%H:%M}-{CALL_WINDOW[1]:%H:%M} and {state_hours.describe(rules)}"
    check("customer_time", ok_customer, f"{window} customer time in {', '.join(zone.zones)} ({zone.detail})")
    check("agent_hours", ok_dealer, f"dealer open hours ({profile.timezone})")
    if ok_customer and ok_dealer:
        return await done(engine.Decision("ALLOW", "inside the customer's calling hours and the dealer's hours",
                                          "allowed", zone=zone.as_dict()))
    until = state_hours.next_allowed(at, zone.zones, rules, profile, extra_window=CALL_WINDOW)
    reasons = ([] if ok_customer else [f"outside {window} customer time ({zone.detail})"]) + (
        [] if ok_dealer else ["dealer closed"])
    if until is None:
        return await done(engine.Decision("BLOCK", "no calling time in the next 14 days: " + "; ".join(reasons),
                                          "no_allowed_time", zone=zone.as_dict()))
    return await done(engine.Decision("HOLD", "; ".join(reasons), "held", until=until, zone=zone.as_dict()))


WINDOW_STEP = timedelta(minutes=5)


async def call_window(*, dealer_id: str, customer_id: str | None, lead_id: str,
                      at: datetime | None = None) -> dict[str, Any]:
    """What staff see on a call task (PLAN_4 stream X1 item 7): may they call now, and "do not call before /
    after" from the customer's state's live-call window, 8:00-21:00 and the dealer's hours, checked again at the
    moment they look (not only when the task opened). Nothing is logged."""
    at = engine._aware(at or clock.now())
    decision = await can_call(dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id, at=at, record=False)
    out: dict[str, Any] = {"checked_at": at, "can_call_now": decision.allowed, "decision": decision.outcome,
                           "reason": decision.reason, "states": (decision.zone or {}).get("states"),
                           "window": next((c["detail"] for c in decision.checks if c["rule"] == "customer_time"),
                                          None),
                           "do_not_call_before": None, "do_not_call_after": None}
    if decision.outcome == "BLOCK":
        return out
    start = at if decision.allowed else decision.until
    if start is None:
        return out
    out["do_not_call_before"] = start
    db = dealer_scoped_db(dealer_id)
    lead = await engine._find(db, PLATFORM_LEADS_COLLECTION, lead_id)
    if not customer_id and lead and lead.get("customer_id"):
        customer_id = str(lead["customer_id"])
    customer = await engine._find(db, PLATFORM_CUSTOMERS_COLLECTION, customer_id)
    phone = await consent.usable_recipient(db, lead, customer, "sms")
    zone = await engine.customer_zone(db, customer_id, phone)
    profile = await dealer_profile(dealer_id)
    rules = state_hours.rules_for(state_hours.zone_states(zone))
    # On whole 5-minute marks, so "not after" reads as a clock time (19:00, not 19:00:00.000180).
    point = start - timedelta(minutes=start.minute % 5, seconds=start.second, microseconds=start.microsecond)
    for _ in range(int(timedelta(hours=24) / WINDOW_STEP)):
        nxt = point + WINDOW_STEP
        if not (engine.in_window(nxt, zone.zones, CALL_WINDOW) and state_hours.allowed(nxt, zone.zones, rules)
                and engine.dealer_open(nxt, profile)):
            # The last allowed moment is just before the first step that fails; staff see "not after" this.
            out["do_not_call_after"] = nxt
            break
        point = nxt
    return out
