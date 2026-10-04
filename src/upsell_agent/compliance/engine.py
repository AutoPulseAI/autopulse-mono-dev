"""The send check: `can_contact` (MASTER_PLAN_3 C1, B3; architecture §15
decisions 18, 23-25, 29, 36, 55-56, 65, 68, 72, 74-77).

    can_contact(customer_id, dealer_id, lead_id, channel, purpose, is_reply, at)
        -> ALLOW | HOLD <until> | REVIEW <reason> | BLOCK <reason>

Plain code, checked in this order; the first rule that stops a message wins:

1. **AI voice** is a separate, higher-risk channel, off (BLOCK).
1b. **Invalid contact** (C6): the phone or email was marked a wrong person or
   hard-bounced. Blocks everything on that address, replies and the opt-out
   confirmation included; the customer's other channel is unaffected.
2. **Opt-out**: the latest `opt_out` entry on this channel for the customer
   or the phone / email (STOP, a natural-language opt-out, a provider
   unsubscribe; decision 140) blocks everything the system starts. The one
   opt-out confirmation and a reply to the customer's own message still go
   (decisions 136-137). After a keyword STOP, Twilio itself still refuses
   texts until START (error 21610).
3. **Do-not-contact**: a lead staff set to "DND" (decision 68). No national
   registry check.
4. **Explicit no** (marketing SMS only): the phone's `sms_opt_in: false`, or
   the lead form's `TCPAOptIn: false`.
5. **A reply** to a message the customer just sent is allowed. In a
   conversation the customer started (inbound) at any hour (decision 56); in
   an outbound one, outside 8:00-21:00 customer time the reply still goes,
   but marked `quiet_hours`: it asks nothing and says the team picks up at
   8:00 (decision 29).
6. **An open review** (a possible opt-out, decision 72) stops marketing.
7. **Consent** for a marketing SMS the business starts (decisions 36, 76):
   the platform's opt-in flag (never after an SMS opt-out: then only the
   customer's own opt-in back counts, decision 141); else, for the AI's follow-ups (not
   campaigns), the customer's own inquiry for 91 days; else a lead-form
   `TCPAOptIn: true` alone → REVIEW (`CONSENT_REVIEW_REQUIRED`); else BLOCK.
   Email needs no consent.
8. **Time** for anything the system starts by SMS: inside the dealer's
   opening hours and inside the customer's window in every zone they may be
   in (decisions 23-25, 70): marketing by the customer's state's own row
   (MASTER_PLAN_4 F1, compliance/state_hours.py: a window per weekday, the
   Sunday and holiday rules; the stricter of the ZIP and area-code states;
   an unknown state gets the strictest row), transactional 8:00-21:00.
   Email has no time rule.
9. **Frequency** (marketing SMS): at most 3 per customer per 24 hours,
   across the AI and campaigns, plus any cap of the state's own row; an
   ALLOW counts as soon as it's given.

Rules 8 and 9 give HOLD with the first time both allow it.

Every decision is added to `ai_compliance_log` (never edited, kept 5 years)
with what was checked, unless `record=False` (planning a due time).
"""

import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, time, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from upsell_agent import clock
from upsell_agent.channels import consent
from upsell_agent.compliance import state_hours
from upsell_agent.compliance.customer_zone import customer_zone
from upsell_agent.compliance.origin import LeadOrigin, lead_origin
from upsell_agent.integrations.dealer_profile import DealerProfile, dealer_profile
from upsell_agent.integrations.mongodb import (
    AI_CALL_TASKS_COLLECTION,
    AI_COMPLIANCE_LOG_COLLECTION,
    AI_MESSAGES_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    DealerScopedDatabase,
    as_object_id,
    dealer_scoped_db,
)

Outcome = Literal["ALLOW", "HOLD", "REVIEW", "BLOCK"]
# `reply`: the answer to a message the customer sent - customer service, not marketing (decision 136).
# `lead_response` (PLAN_4 stream X1 item 1, TCPA PDF §4 "Consumer-initiated lead response"): the first message
# on a new lead. Its own class: every suppression rule, the review, the customer's state window and the cap
# apply, but a genuine consumer inquiry (inbound origin) needs no marketing consent. A lead that isn't the
# consumer reaching out (a CSV / DMS import, DealerVault, a campaign, an unmapped source) is outbound marketing.
Purpose = Literal["marketing", "transactional", "opt_out_confirmation", "reply", "lead_response"]

# Customer-local windows (start, end), end exclusive.
# Decision 25's interim 8:00-20:00 for everyone. Marketing texts now follow the per-state table
# (MASTER_PLAN_4 F1, compliance/state_hours.py); kept for anything that still imports it.
MARKETING_WINDOW = (time(8), time(20))
TRANSACTIONAL_WINDOW = (time(8), time(21))  # decision 18: 8:00-21:00 customer time
REPLY_WINDOW = (time(8), time(21))          # decision 29: outbound conversations keep going only inside this
MARKETING_SMS_CAP = 3
# Texts counted toward (and held by) the 3-in-24h cap and the state rows' caps (PLAN_4 stream X1 item 1).
CAPPED_PURPOSES = ("marketing", "lead_response")
CAP_PERIOD = timedelta(hours=24)
# The customer's own inquiry allows follow-ups until the opportunity closes (Day 91).
INQUIRY_DAYS = 91
SEARCH_DAYS = 14
DND_STATUSES = {"dnd", "do not disturb", "do not contact"}


@dataclass
class Decision:
    outcome: Outcome
    reason: str
    rule: str
    until: datetime | None = None
    # A reply in an outbound conversation outside the reply window (decision 29).
    quiet_hours: bool = False
    resume_at: datetime | None = None
    origin: dict[str, Any] = field(default_factory=dict)
    zone: dict[str, Any] = field(default_factory=dict)
    consent: dict[str, Any] = field(default_factory=dict)
    frequency: dict[str, Any] = field(default_factory=dict)
    checks: list[dict[str, Any]] = field(default_factory=list)
    log_id: str | None = None
    # PLAN_4 stream X1 item 8: the opt-out entry that decided it (BLOCK) or that a reply went out despite.
    opt_out_event_id: str | None = None

    @property
    def allowed(self) -> bool:
        return self.outcome == "ALLOW"

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        for key in ("until", "resume_at"):
            if data[key] is not None:
                data[key] = data[key].isoformat()
        return data

    def summary(self) -> str:
        if self.outcome == "HOLD" and self.until:
            return f"HOLD until {self.until.isoformat()}: {self.reason}"
        return f"{self.outcome}: {self.reason}"


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=clock.now().tzinfo)


def in_window(at: datetime, zones: tuple[str, ...] | list[str], window: tuple[time, time]) -> bool:
    """`at` is inside `window` local time in every one of `zones`."""
    return all(window[0] <= at.astimezone(ZoneInfo(z)).time() < window[1] for z in zones)


def dealer_open(at: datetime, profile: DealerProfile) -> bool:
    return profile.is_open(at)


def _boundaries(start: datetime, zones: tuple[str, ...], window: tuple[time, time],
                profile: DealerProfile | None) -> list[datetime]:
    """Every moment from `start` on when a window can open: each zone's window
    start and each opening time, for the next SEARCH_DAYS days."""
    points = {start}
    for offset in range(SEARCH_DAYS + 1):
        for zone in zones:
            tz = ZoneInfo(zone)
            day = (start.astimezone(tz) + timedelta(days=offset)).date()
            points.add(datetime.combine(day, window[0], tzinfo=tz).astimezone(start.tzinfo))
        if profile:
            day = (start.astimezone(profile.tz) + timedelta(days=offset)).date()
            hours = profile.hours.get(day.weekday())
            if hours:
                points.add(datetime.combine(day, hours[0], tzinfo=profile.tz).astimezone(start.tzinfo))
    return sorted(p for p in points if p >= start)


def next_allowed(start: datetime, zones: tuple[str, ...], window: tuple[time, time],
                 profile: DealerProfile | None) -> datetime | None:
    """The first time from `start` inside the customer window in every zone
    and, with `profile`, inside the dealer's opening hours."""
    for point in _boundaries(start, zones, window, profile):
        if in_window(point, zones, window) and (profile is None or dealer_open(point, profile)):
            return point
    return None


async def _find(db: DealerScopedDatabase, collection: str, doc_id: str | None) -> dict | None:
    if not doc_id:
        return None
    return await db.collection(collection).find_one({"_id": as_object_id(doc_id)})


def _is_dnd(lead: dict | None) -> bool:
    lead = lead or {}
    return any(str(lead.get(k) or "").strip().lower() in DND_STATUSES
               for k in ("fe_lead_status", "lead_status", "status"))


_DND_PATTERN = {"$regex": r"^\s*(dnd|do not disturb|do not contact)\s*$", "$options": "i"}


async def _dnd_elsewhere(db: DealerScopedDatabase, lead: dict | None, customer: dict | None,
                         customer_id: str | None) -> dict | None:
    """PLAN_4 stream X1 item 6: a DND staff set on ANY of this dealer's leads for the same customer, phone or email
    suppresses the customer everywhere at this dealer - a new web lead, a re-import with a new customer id. Returns
    that lead, or None."""
    who: list[dict[str, Any]] = []
    if customer_id:
        who.append({"customer_id": {"$in": [customer_id, as_object_id(customer_id)]}})
    phones = {consent.address_key("sms", p) for p in consent.recipient_candidates(lead, customer, "sms")} - {None}
    for phone in phones:
        digits = "".join(c for c in phone if c.isdigit())[-10:]
        who.append({"phone": {"$regex": f"{digits}$"}})
    emails = {consent.address_key("email", e) for e in consent.recipient_candidates(lead, customer, "email")} - {None}
    for email in emails:
        who.append({"email": {"$regex": f"^\\s*{re.escape(email)}\\s*$", "$options": "i"}})
    if not who:
        return None
    status = {"$or": [{k: _DND_PATTERN} for k in ("fe_lead_status", "lead_status", "status")]}
    return await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"$and": [{"$or": who}, status]},
                                                                  projection={"_id": 1})


def _lead_created(lead: dict | None) -> datetime | None:
    lead = lead or {}
    created = lead.get("createdAt") or lead.get("created_at")
    if isinstance(created, datetime):
        return _aware(created)
    oid = lead.get("_id")
    return oid.generation_time if hasattr(oid, "generation_time") else None


async def _customer_wrote(db: DealerScopedDatabase, lead_id: str | None) -> bool:
    if not lead_id:
        return False
    return await db.collection(AI_MESSAGES_COLLECTION).count_documents(
        {"lead_id": lead_id, "direction": "inbound"}) > 0


async def marketing_sms_consent(db: DealerScopedDatabase, *, customer_id: str | None, lead_id: str | None,
                                lead: dict | None, customer: dict | None, to: str | None, origin: LeadOrigin,
                                campaign: bool, at: datetime) -> dict[str, Any]:
    """B0.4's steps 2-6 for a marketing text the business starts (step 1,
    the explicit no, is checked before). Returns {status, source, detail,
    evidence_id}; status is `granted`, `review_required` or `none`."""
    if await consent.ever_opted_out(db, customer_id, "sms", to):
        # After an opt-out only the customer's own opt-in back (START, "YES", a phrase) counts (decision 141).
        back = await consent.latest_opt_out(db, customer_id, "sms", to)
        if back and back["consent_status"] == "opted_in" and back["consent_source"].startswith("customer_"):
            return {"status": "granted", "source": back["consent_source"],
                    "evidence_id": str(back["_id"]),
                    "detail": f"the customer opted back in to texts ({back['consent_source']})"}
    # PLAN_4 stream X1 item 4: the platform's `sms_opt_in: true` is NOT marketing consent. The CRM sets it on any
    # inbound text (processSms.js / aiInbound.js linkCustomerToLead smsOptIn: true): a customer asking "what time
    # do you close?" never agreed to campaigns. It only ever supported answering that conversation (a reply needs
    # no consent). Its `false` is still an explicit no (rule 4).

    if not campaign:
        created = _lead_created(lead)
        fresh = created is None or at - created <= timedelta(days=INQUIRY_DAYS)
        wrote = await _customer_wrote(db, lead_id)
        if fresh and (origin.origin == "inbound" or wrote):
            why = "a lead they submitted" if origin.origin == "inbound" else "a message they sent us"
            return {"status": "granted", "source": "own_inquiry", "evidence_id": f"inquiry:{lead_id}",
                    "detail": f"follow-up on the customer's own inquiry ({why}), within {INQUIRY_DAYS} days"}

    # PLAN_4 stream X1 item 8 (TCPA PDF §6): the provider's consent object, kept whole. Complete (disclosure,
    # its version, the time, the phone we'd text) it counts; anything less is CONSENT_REVIEW_REQUIRED.
    provider = consent.lead_provider_consent(lead)
    if provider and provider.get("opted_in"):
        missing = consent.missing_provider_evidence(provider, to)
        evidence_id = f"lead_form:{lead_id}" if provider["format"] == "comment_line" else f"lead_provider:{lead_id}"
        if not missing:
            return {"status": "granted", "source": "lead_provider", "evidence_id": evidence_id,
                    "text_version": provider.get("disclosure_version"), "evidence": provider,
                    "detail": f"the lead provider's consent record ({provider.get('provider')}, disclosure "
                              f"{provider.get('disclosure_version')}, given {provider.get('consent_timestamp')})"}
        what = (f"lead form says {provider.get('quote')!r}" if provider["format"] == "comment_line"
                else f"the lead provider's consent ({provider.get('provider')})")
        return {"status": "review_required", "source": "lead_provider", "evidence_id": evidence_id,
                "text_version": provider.get("disclosure_version"), "missing": missing,
                "detail": f"{what}, missing {', '.join(missing)}: CONSENT_REVIEW_REQUIRED"}
    missing = "not a follow-up on their own inquiry" if campaign else "no inquiry of their own"
    return {"status": "none", "source": None, "evidence_id": None,
            "detail": f"no text consent (no platform opt-in flag, {missing})"}


async def _marketing_sms_sent_recently(db: DealerScopedDatabase, customer_id: str | None, to: str | None,
                                       at: datetime) -> list[datetime]:
    """ALLOWed marketing texts to this customer in the last 24 hours."""
    who: dict[str, Any] = {"customer_id": customer_id} if customer_id else {"to": to}
    rows = await db.collection(AI_COMPLIANCE_LOG_COLLECTION).find(
        {**who, "channel": "sms", "purpose": {"$in": list(CAPPED_PURPOSES)}, "is_reply": False,
         "decision": "ALLOW",
         "at": {"$gt": at - CAP_PERIOD, "$lte": at}}).to_list(None)
    return sorted(_aware(r["at"]) for r in rows)


async def can_contact(
    *,
    dealer_id: str,
    customer_id: str | None,
    lead_id: str | None,
    channel: str,
    purpose: Purpose,
    is_reply: bool,
    at: datetime | None = None,
    to: str | None = None,
    lead: dict | None = None,
    customer: dict | None = None,
    campaign: bool = False,
    source: str = "ai",
    request_id: str | None = None,
    record: bool = True,
    message_id: str | None = None,
    template_id: str | None = None,
) -> Decision:
    """`campaign`: a platform campaign text (the customer's own inquiry
    doesn't cover it). `source` says who is asking (ai_reply, ai_followup,
    campaign, ...), for the log. `record=False` only when planning."""
    db = dealer_scoped_db(dealer_id)
    at = _aware(at or clock.now())
    lead = lead if lead is not None else await _find(db, PLATFORM_LEADS_COLLECTION, lead_id)
    if not customer_id and lead and lead.get("customer_id"):
        customer_id = str(lead["customer_id"])
    customer = customer if customer is not None else await _find(db, PLATFORM_CUSTOMERS_COLLECTION, customer_id)
    if to is None and channel in ("sms", "email"):
        to = await consent.usable_recipient(db, lead, customer, channel)  # type: ignore[arg-type]

    checks: list[dict[str, Any]] = []

    def check(rule: str, passed: bool, detail: str) -> None:
        checks.append({"rule": rule, "passed": passed, "detail": detail})

    origin = await lead_origin(db, lead, customer)
    decision = await _decide(db, check, dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id,
                             channel=channel, purpose=purpose, is_reply=is_reply, at=at, to=to, lead=lead,
                             customer=customer, campaign=campaign, origin=origin)
    decision.origin = origin.as_dict()
    decision.checks = checks
    if record:
        decision.log_id = await _log(db, decision, customer_id=customer_id, lead_id=lead_id, channel=channel,
                                     purpose=purpose, is_reply=is_reply, at=at, to=to, source=source,
                                     request_id=request_id, campaign=campaign, message_id=message_id,
                                     template_id=template_id)
    return decision


async def _decide(db: DealerScopedDatabase, check, *, dealer_id: str, customer_id: str | None,
                  lead_id: str | None, channel: str, purpose: Purpose, is_reply: bool, at: datetime,
                  to: str | None, lead: dict | None, customer: dict | None, campaign: bool,
                  origin: LeadOrigin) -> Decision:
    # 1. AI voice.
    if channel == "voice":
        check("ai_voice", False, "AI voice calls are a separate, higher-risk channel and are off")
        return Decision("BLOCK", "AI voice calls are off", "ai_voice_disabled")
    check("ai_voice", True, f"channel is {channel}")

    if purpose == "lead_response":
        is_reply = False  # never the reply exemption: the business sends first
        if origin.origin != "inbound":
            # PLAN_4 stream X1 item 1: an imported / historical / campaign record is not a consumer inquiry.
            check("lead_response", False, f"not a consumer-initiated lead ({origin.rule}): its first message is "
                                          "outbound marketing")
            purpose = "marketing"
        else:
            check("lead_response", True, f"a consumer-initiated lead ({origin.rule})")

    # 2. Opt-out on this channel, by customer or by phone / email (decision 140).
    address = to or consent.resolve_recipient(lead, customer, "email" if channel == "email" else "sms")
    if await consent.is_invalid(db, channel, address):
        check("invalid_contact", False, f"{address} was marked invalid (wrong person or hard bounce)")
        return Decision("BLOCK", f"{address} is marked invalid (wrong person, bad number or hard bounce)",
                        "invalid_contact")
    check("invalid_contact", True, f"{channel} address not marked invalid")
    opt_out_entry = await consent.latest_opt_out(db, customer_id, channel, address)
    opted_out = bool(opt_out_entry and opt_out_entry["consent_status"] == "opted_out")
    if opted_out and purpose != "opt_out_confirmation" and not is_reply:
        check("opt_out", False, f"the customer opted out of {channel}")
        return Decision("BLOCK", f"the customer opted out of {channel}", "opted_out",
                        opt_out_event_id=str(opt_out_entry["_id"]))
    check("opt_out", True,
          "opt-out confirmation (allowed once)" if opted_out and purpose == "opt_out_confirmation"
          else f"opted out of {channel}, but this replies to the customer's own message (decision 136)"
          if opted_out else f"not opted out of {channel}")
    if purpose == "opt_out_confirmation":
        return Decision("ALLOW", "the one confirmation of the customer's opt-out", "opt_out_confirmation")

    # 3. Do-not-contact.
    if _is_dnd(lead):
        check("do_not_contact", False, "staff set the lead to DND")
        return Decision("BLOCK", "the lead is on the dealer's do-not-contact list (DND)", "do_not_contact")
    if other := await _dnd_elsewhere(db, lead, customer, customer_id):
        check("do_not_contact", False, f"staff set another lead of this customer / phone / email to DND "
                                       f"({other['_id']})")
        return Decision("BLOCK", "the customer is on the dealer's do-not-contact list (DND on another of their "
                                 "leads)", "do_not_contact")
    check("do_not_contact", True, "not on the dealer's do-not-contact list")

    marketing_sms = purpose == "marketing" and channel == "sms" and not is_reply
    lead_response_sms = purpose == "lead_response" and channel == "sms"
    # 4. An explicit no (marketing texts and the first message on a lead; a reply still goes out).
    provider = consent.lead_provider_consent(lead)
    form = (provider["opted_in"], provider.get("quote") or "the lead provider's consent record") \
        if provider and provider.get("opted_in") is not None else None
    if provider and customer_id:
        # PLAN_4 stream X1 item 8: the whole evidence object, its disclosure version and source URL (TCPA PDF §6).
        complete = provider.get("opted_in") and not consent.missing_provider_evidence(provider, to)
        await consent.record_consent(
            db, customer_id=customer_id, channel="sms", consent_type="marketing_consent",
            status="denied" if provider.get("opted_in") is False else "granted" if complete else "review_required",
            source="lead_form" if provider["format"] == "comment_line" else "lead_provider", lead_id=lead_id,
            evidence_id=(f"lead_form:{lead_id}" if provider["format"] == "comment_line"
                         else f"lead_provider:{lead_id}"),
            evidence={**provider, "lead_source": origin.source}, text_version=provider.get("disclosure_version"),
            source_url=provider.get("source_url"), address=consent.address_key("sms", provider.get("phone")))
    if marketing_sms or lead_response_sms:
        flag, _ = consent.phone_opt_in(customer, to)
        if flag is False:
            check("explicit_no", False, "the phone is marked sms_opt_in: false on the customer record")
            return Decision("BLOCK", "the customer's phone is marked not to be texted (sms_opt_in: false)",
                            "explicit_no")
        if form and not form[0]:
            check("explicit_no", False, f"the lead form says {form[1]!r}")
            return Decision("BLOCK", f"the lead form says the customer didn't opt in ({form[1]})", "explicit_no")
        check("explicit_no", True, "no explicit no")

    phone = to if channel == "sms" else consent.resolve_recipient(lead, customer, "sms")
    zone = await customer_zone(db, customer_id, phone)

    # 5. A reply to the customer's own message.
    if is_reply:
        if origin.origin == "inbound" or channel != "sms":
            check("reply", True, "a reply in a conversation the customer started: any hour"
                  if origin.origin == "inbound" else "a reply by email: no time rule")
            return Decision("ALLOW", "a reply to the customer's own message", "reply", zone=zone.as_dict())
        if in_window(at, zone.zones, REPLY_WINDOW):
            check("reply", True, "a reply in an outbound conversation, inside 8:00-21:00 customer time")
            return Decision("ALLOW", "a reply to the customer's own message", "reply", zone=zone.as_dict())
        resume = next_allowed(at, zone.zones, REPLY_WINDOW, None)
        check("reply", True, "outbound conversation outside 8:00-21:00 customer time: one reply, no questions, "
                             "the team picks up at 8:00")
        return Decision("ALLOW", "a reply outside 8:00-21:00 customer time in an outbound conversation: it goes "
                                 "out, asks nothing, and says the team picks up at 8:00", "reply_quiet_hours",
                        quiet_hours=True, resume_at=resume, zone=zone.as_dict())

    # 6. An open review stops everything the system starts (PLAN_4 stream X1 item 3: transactional too - the
    # countdown with its photo, the no-show follow-up); only a reply to the customer's own message goes (rule 5).
    if customer_id and (review := await consent.open_review(db, customer_id)):
        quote = (review.get("evidence") or {}).get("message")
        check("review", False, f"possible opt-out awaiting review: {quote!r}")
        return Decision("REVIEW", f"possible opt-out awaiting review ({quote!r})", "review_open",
                        zone=zone.as_dict())
    check("review", True, "no open review")

    # 7. Consent for a marketing text.
    consent_info: dict[str, Any] = {}
    if marketing_sms:
        consent_info = await marketing_sms_consent(db, customer_id=customer_id, lead_id=lead_id, lead=lead,
                                                   customer=customer, to=to, origin=origin, campaign=campaign,
                                                   at=at)
        if consent_info["status"] == "review_required":
            check("consent", False, consent_info["detail"])
            return Decision("REVIEW", consent_info["detail"], "consent_review_required", zone=zone.as_dict(),
                            consent=consent_info)
        if consent_info["status"] != "granted":
            check("consent", False, consent_info["detail"])
            return Decision("BLOCK", consent_info["detail"], "no_consent", zone=zone.as_dict(),
                            consent=consent_info)
        check("consent", True, consent_info["detail"])
    elif purpose == "lead_response":
        consent_info = {"status": "inquiry", "source": "consumer_inquiry", "evidence_id": f"inquiry:{lead_id}",
                        "lead_source": origin.source,
                        "detail": "a response to the consumer's own inquiry: no marketing consent needed"}
        check("consent", True, consent_info["detail"])
    else:
        check("consent", True, "email needs no consent (unsubscribe link and postal address)" if channel == "email"
              else f"{purpose}: no marketing consent needed")

    # 8 and 9. Time and frequency (texts the system starts).
    if channel != "sms":
        check("time", True, "email has no time-of-day rule")
        return Decision("ALLOW", f"{purpose} email", "allowed", zone=zone.as_dict(), consent=consent_info)

    profile = await dealer_profile(dealer_id)
    window = MARKETING_WINDOW if purpose == "marketing" else TRANSACTIONAL_WINDOW
    # MASTER_PLAN_4 F1: marketing follows the customer's state's own row(s) (client's TCPA tables, 1 Oct).
    # PLAN_4 stream X1 item 7: transactional texts follow the state rows too (state windows apply to every
    # automated text; replies to the customer's own message keep their exemption, rule 5).
    # PLAN_4 stream X1 item 10: an AI text is an automated message, so the automated-device rows apply (IN, ME).
    rules = (state_hours.rules_for(state_hours.zone_states(zone), automated=True)
             if purpose in (*CAPPED_PURPOSES, "transactional") else None)
    if purpose == "marketing" and (banned := state_hours.unsolicited_sales_banned(rules or [])):
        solicited = (consent_info.get("source") in ("lead_provider",)
                     or str(consent_info.get("source") or "").startswith("customer_")
                     or (consent_info.get("source") == "own_inquiry" and origin.origin == "inbound"))
        if not solicited:
            check("unsolicited_sales_ban", False, f"{', '.join(banned)} bans unsolicited sales texts to cell "
                                                  "phones (N.J.S.A. 56:8-130) and this isn't a follow-up the "
                                                  "customer asked for")
            return Decision("BLOCK", f"{', '.join(banned)}: no unsolicited sales texts to cell phones",
                            "unsolicited_sales_ban", zone=zone.as_dict(), consent=consent_info)
        check("unsolicited_sales_ban", True, f"{', '.join(banned)}: the customer's own inquiry or express consent")
    earliest = at
    frequency: dict[str, Any] = {}
    if purpose in CAPPED_PURPOSES:
        recent = await _marketing_sms_sent_recently(db, customer_id, to, at)
        frequency = {"sent_last_24h": len(recent), "cap": MARKETING_SMS_CAP}
        if len(recent) >= MARKETING_SMS_CAP:
            earliest = recent[-MARKETING_SMS_CAP] + CAP_PERIOD
            frequency["free_at"] = earliest.isoformat()
            check("frequency", False,
                  f"{len(recent)} marketing texts in the last 24 hours (cap {MARKETING_SMS_CAP})")
        else:
            check("frequency", True, f"{len(recent)} of {MARKETING_SMS_CAP} marketing texts in the last 24 hours")
        # PLAN_4 stream X1 item 7: the state's own cap (FL / OK / MD "3 per 24 hours") counts staff calls too.
        calls = await calls_recently(db, customer_id, at) if state_hours.caps(rules or []) else []
        if calls:
            frequency["calls_last_24h"] = len(calls)
        earliest = _state_caps(check, frequency, rules or [], sorted(recent + calls), at, earliest)

    window_text = state_hours.describe(rules) if rules else f"{window[0]:%H:%M}-{window[1]:%H:%M}"
    ok_customer = state_hours.allowed(at, zone.zones, rules) if rules else in_window(at, zone.zones, window)
    # PLAN_4 stream X1 item 1: a consumer's own inquiry is answered while the dealer is closed (the after-hours
    # "now or when we open?" choice), but only inside the customer's state window.
    dealer_hours_apply = purpose != "lead_response"
    ok_dealer = dealer_open(at, profile) if dealer_hours_apply else True
    check("customer_time", ok_customer, f"{window_text} customer time in {', '.join(zone.zones)} ({zone.detail})")
    check("dealer_hours", ok_dealer, f"dealer open hours ({profile.timezone})" if dealer_hours_apply
          else "a response to the consumer's own inquiry: the after-hours choice covers a closed dealer")
    if earliest == at and ok_customer and ok_dealer:
        return Decision("ALLOW", f"{purpose} text inside the customer's window and the dealer's hours", "allowed",
                        zone=zone.as_dict(), consent=consent_info, frequency=frequency)

    hours = profile if dealer_hours_apply else None
    until = (state_hours.next_allowed(earliest, zone.zones, rules, hours) if rules
             else next_allowed(earliest, zone.zones, window, hours))
    reasons = []
    if earliest != at:
        reasons.append("frequency cap: " + (frequency.get("cap_text")
                                            or f"{MARKETING_SMS_CAP} marketing texts in 24 hours"))
    if not ok_customer:
        reasons.append(f"outside {window_text} customer time ({zone.detail})")
    if not ok_dealer:
        reasons.append("dealer closed")
    if until is None:
        return Decision("BLOCK", "no allowed time in the next 14 days: " + "; ".join(reasons), "no_allowed_time",
                        zone=zone.as_dict(), consent=consent_info, frequency=frequency)
    return Decision("HOLD", "; ".join(reasons), "held", until=until, zone=zone.as_dict(), consent=consent_info,
                    frequency=frequency)


# Call outcomes that mean a person actually dialled (a dismissed task is no call).
DIALLED_OUTCOMES = ("connected", "no_answer", "voicemail", "other", None)


async def calls_recently(db: DealerScopedDatabase, customer_id: str | None, at: datetime) -> list[datetime]:
    """Staff calls to this customer recorded in the last 24 hours (a completed call task: PLAN_4 stream X1 item 7),
    for the states whose cap counts calls and texts together."""
    if not customer_id:
        return []
    rows = await db.collection(AI_CALL_TASKS_COLLECTION).find(
        {"customer_id": customer_id, "status": "completed", "outcome": {"$in": list(DIALLED_OUTCOMES)},
         "closed_at": {"$gt": at - CAP_PERIOD, "$lte": at}}, projection={"closed_at": 1}).to_list(None)
    return sorted(_aware(r["closed_at"]) for r in rows)


def _state_caps(check, frequency: dict[str, Any], rules: list[state_hours.StateRule], recent: list[datetime],
                at: datetime, earliest: datetime) -> datetime:
    """A state row's own cap (MASTER_PLAN_4 F1), on top of the 3-in-24h one
    above: the first time every cap has room again. Today's table only has
    3 per 24 hours (FL, OK, MD), the same as ours, but a row with a tighter
    cap would hold here."""
    for count, period in state_hours.caps(rules):
        inside = [r for r in recent if r > at - period]
        if len(inside) < count:
            continue
        free = inside[-count] + period
        check("state_frequency", False, f"{len(inside)} marketing texts and calls in the last {period} (the "
                                        f"state's cap is {count})")
        if free > earliest:
            earliest = free
            hours = int(period.total_seconds() // 3600)
            frequency.update(free_at=free.isoformat(),
                             cap_text=f"{count} texts and calls in {hours} hours (the state's own cap)")
    return earliest


async def _log(db: DealerScopedDatabase, decision: Decision, *, customer_id: str | None, lead_id: str | None,
               channel: str, purpose: str, is_reply: bool, at: datetime, to: str | None, source: str,
               request_id: str | None, campaign: bool, message_id: str | None = None,
               template_id: str | None = None) -> str:
    """One add-only row per decision with the TCPA PDF §11 audit fields. `delivery` is filled in afterwards from
    the send and the provider's callback (channels/sender.py, channels/delivery.py: record_delivery); nothing
    else on the row is ever changed."""
    zones = decision.zone.get("zones") or []
    doc = {
        "at": at, "logged_at": clock.now(), "customer_id": customer_id, "lead_id": lead_id, "channel": channel,
        "to": to, "purpose": purpose, "is_reply": is_reply, "campaign": campaign, "source": source,
        "request_id": request_id, "origin": decision.origin.get("origin"),
        # PLAN_4 stream X1 item 8: lead source, disclosure version, message / template, the opt-out event.
        "lead_source": decision.origin.get("source"), "origin_rule": decision.origin.get("rule"),
        "message_id": message_id, "template_id": template_id, "opt_out_event_id": decision.opt_out_event_id,
        "consent_text_version": decision.consent.get("text_version"),
        "rules_version": state_hours.RULES_VERSION, "delivery": {"status": None},
        "consent_evidence_id": decision.consent.get("evidence_id"), "consent": decision.consent,
        "jurisdiction": {"zones": zones, "state": decision.zone.get("state"), "method": decision.zone.get("method"),
                         # MASTER_PLAN_4 F1: which states' rows applied, and the table's version.
                         "states": decision.zone.get("states"), "rules_version": state_hours.RULES_VERSION},
        "local_time": {z: at.astimezone(ZoneInfo(z)).strftime("%a %H:%M") for z in zones},
        "dnc": next((c for c in decision.checks if c["rule"] == "do_not_contact"), None),
        "frequency": decision.frequency, "decision": decision.outcome, "decision_reason": decision.reason,
        "rule": decision.rule, "until": decision.until, "quiet_hours": decision.quiet_hours,
        "checks": decision.checks,
    }
    inserted = await db.collection(AI_COMPLIANCE_LOG_COLLECTION).insert_one(doc)
    return str(inserted.inserted_id)
