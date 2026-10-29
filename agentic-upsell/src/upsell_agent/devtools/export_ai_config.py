"""Exports the AI's built-in settings as the AI Studio's version 1 (client, 13 Oct 2026: "everything should be dynamic
... she should be able to see and add / update / delete, and the things that already exist should be reflected").

Reads today's code - nothing is retyped by hand - and writes one JSON file the CRM loads as the first version of every
AI Studio item (aidmvcs-be-dev app/lib/ai/aiStudioDefaults.json). Messages are rendered with {placeholders}, so the
seed shows exactly what customers get today.

    PYTHONPATH=src python -m upsell_agent.devtools.export_ai_config ../aidmvcs-be-dev/app/lib/ai/aiStudioDefaults.json
"""

import json
import sys
from datetime import UTC, datetime
from typing import Any

from upsell_agent.agent import (
    appointment,
    buyers_order,
    cadence,
    cannot_supply,
    escalation,
    lead_bucket,
    llm,
    multi_vehicle,
    owner_touches,
    sold_delivered,
    sold_pending,
    specialists,
    templates,
)
from upsell_agent.agent.nodes import decide
from upsell_agent.compliance import origin
from upsell_agent.scheduler import followups

PLACEHOLDERS = {
    "first_name": "Customer's first name", "dealership": "Dealership name", "agent_name": "AI agent's name",
    "vehicle": "Year, make and model", "model": "Vehicle model", "price": "Listed price", "times": "Two open times",
    "date": "Appointment date", "time": "Appointment time", "address": "Dealership address",
    "ask_for": "Who to ask for (assigned salesperson)", "dealer_phone": "Dealership phone",
    "credit_app_link": "Credit application link", "vehicle_link": "Vehicle page link", "opens_at": "When we open", "recommended_work": "Work the technicians recommended",
    # Client, 20 Oct 2026 (Betsy: "where is vehicle image and vehicle mileage and other data points ... that we can
    # autofill?"): the car's own data from the inventory feed (agent/cannot_supply.py vehicle_values).
    "trim": "Trim", "mileage": "Mileage", "color": "Exterior color", "vin": "VIN",
    "recall_id": "Recall number", "recall_summary": "What the recall is about", "recall_source": "Where it's from (NHTSA)",
}
_SAMPLE_APPT = datetime(2026, 10, 16, 14, 0, tzinfo=UTC)


def fixed(text: str, *, email: str | None = None, subject: str | None = None) -> dict[str, Any]:
    return {"mode": "fixed", "text": text, "email_text": email, "email_subject": subject, "instruction": None,
            "fallback": None}


STILL_WITH_ME = "still_with_me"


def ai(instruction: str, *, fallback: str | None = None) -> dict[str, Any]:
    return {"mode": "ai", "text": None, "email_text": None, "email_subject": None, "instruction": instruction,
            "fallback": fallback}


def _placeholdered(rendered: dict[str, str], swaps: dict[str, str]) -> dict[str, Any]:
    def swap(text: str | None) -> str | None:
        for real, ph in swaps.items():
            text = (text or "").replace(real, ph)
        return text or None
    return fixed(swap(rendered.get("sms_text")) or "", email=swap(rendered.get("email_body")),
                 subject=swap(rendered.get("email_subject")))


def agents() -> list[dict[str, Any]]:
    patterns = dict(specialists._PATTERNS)
    return [{"key": sid, "name": s.name, "content": {
        "playbook": s.playbook, "never": s.never, "steps_in_when": patterns.get(sid, "default (everything else)"),
        "lead_bucket_default": next((b for b, a in specialists._BUCKET_DEFAULT.items() if a == sid), None),
        "examples": []}} for sid, s in specialists.SPECIALISTS.items()]


def buckets() -> list[dict[str, Any]]:
    sources = {b: p for b, p in lead_bucket.BUCKET_SOURCES}
    return [{"key": b, "name": {"credit": "Credit / financing", "trade_in": "Trade-in / sell my car",
                                "general": "General sales"}[b],
             "content": {"source_pattern": sources.get(b), "word_track": lead_bucket.WORD_TRACKS.get(b),
                         "agent": specialists._BUCKET_DEFAULT.get(b, specialists.SALES)}} for b in lead_bucket.BUCKETS]


def sources() -> list[dict[str, Any]]:
    return [{"key": "inbound_sources", "name": "Lead sources: the customer reached out (inbound)",
             "content": {"pattern": origin.INBOUND_SOURCES.pattern,
                         "note": "A lead from any matching source is the customer reaching out (FTC intro: "
                                 "'following up on your interest')."}},
            {"key": "outbound_sources", "name": "Lead sources: DealerVault / imports (outbound)",
             "content": {"pattern": origin.DMS_SOURCES.pattern}}]


def _wait(amount: float, unit: str, after: str = "previous", at: str | None = None) -> dict[str, Any]:
    """A touch's timing (client, 13 Oct 2026): any number of minutes ... years after the previous touch or the start."""
    return {"amount": amount, "unit": unit, "after": after, **({"at": at} if at else {})}


def _theme_step(day: int | str, theme: cadence.Theme, when: str, wait: dict[str, Any] | None = None
                ) -> dict[str, Any]:
    return {"id": theme.id, "day": day, "when": when, "label": theme.label, "channels": ["sms", "email"],
            "message": {**ai(theme.instruction), "email_subject": (cadence.SUBJECTS.get(theme.id) or (None,))[0]},
            **({"wait": wait} if wait else {})}


def cadences() -> list[dict[str, Any]]:
    sales_steps = [
        {"id": "touch1", "day": 1, "when": "Immediately (or the next allowed time)", "label": "First message (FTC)",
         "channels": ["sms", "email"], "wait": _wait(0, "minutes", "start"), "message": {
             **fixed("Hi {first_name}, this is {agent_name}, {dealership}'s AI Sales Manager, following up on your "
                     "interest in the {vehicle}. {price_line} Tell me, what are you driving now?"),
             "mode": "fixed_opening_ai",
             "instruction": "Answer what the lead form asked (mileage, CARFAX, availability) between the opening and "
                            "the closing question."}},
        {"id": cadence.NAME_NUDGE.id, "day": 1, "when": "3 hours after the first message", "label": "Name nudge",
         "channels": ["sms", "email"], "wait": _wait(3, "hours"),
         "message": fixed("{first_name}?", email="Hi {first_name},\n\nJust checking that you saw my last message about "
                                                 "the {vehicle}. Is there anything I can help you with?\n\nThank you",
                          subject="Just checking in")},
        *[_theme_step(i + 2, t, f"Day {i + 2}", _wait(i + 1, "days", "start", "10:00"))
          for i, t in enumerate(cadence.DAY_THEMES)],
    ]
    return [
        {"key": "sales_days_1_7", "name": "Sales follow-up: Days 1-7", "content": {"steps": sales_steps,
         "stops_when": ["customer replies", "appointment set", "opt-out", "sales visit"]}},
        # The client's grid (agent/cadence.py EXTENDED_GRID): days 14, 21, 28, then 58 and 88; closes after day 90.
        {"key": "sales_days_8_30", "name": "Sales follow-up: Days 8-30 (weekly)", "content": {
            "repeat": {"first": _wait(13, "days", "start", "10:00"), "every": _wait(7, "days", at="10:00"),
                       "until": _wait(29, "days", "start")},
            "steps": [_theme_step("8-30", t, "Weekly") for t in cadence.NURTURE_THEMES]}},
        {"key": "sales_days_31_90", "name": "Sales follow-up: Days 31-90 (monthly)", "content": {
            "repeat": {"first": _wait(57, "days", "start", "10:00"), "every": _wait(30, "days", at="10:00"),
                       "until": _wait(89, "days", "start")},
            "closes_after": _wait(90, "days", "start"),
            "steps": [_theme_step("31-90", t, "Monthly") for t in cadence.DEEPER_THEMES],
            "day_91": "The opportunity closes (Closed - Lost); the customer stays in the CRM."}},
        {"key": "sold_pending", "name": "Sold Pending", "content": {
            "steps": [{"id": f"week_{n}", "when": f"Touch {n} (day {sold_pending.touch_due_day(n)})",
                       "wait": _wait(sold_pending.touch_due_day(n), "days", "start"),
                       "label": sold_pending.theme_for(n).label if hasattr(sold_pending.theme_for(n), "label") else
                       f"Touch {n}", "channels": ["sms", "email"],
                       "message": _placeholdered(sold_pending.render_touch(
                           n, first_name="Qzfirst", dealership="DEALERSHIP", vehicle="VEHICLE", documents=n == 1),
                           {"Qzfirst": "{first_name}", "DEALERSHIP": "{dealership}", "VEHICLE": "{vehicle}"})}
                      for n in range(1, 7)]}},
        {"key": "owner_lifecycle", "name": "Sold Delivered: owner lifecycle", "content": {
            "steps": [{"id": t, **({"wait": _wait(owner_touches.OWNER_TOUCH_DAYS[t], "days", "start")}
                                   if t in owner_touches.OWNER_TOUCH_DAYS else {}),
                       "when": {"review_referral": "Day 14", "first_30": "Day 30", "first_90": "About day 90",
                                         "birthday": "Every year (month and day)", "anniversary": "Every year, 10 years",
                                         "lease_end": "90 days before the lease ends", "payoff": "When finance is paid off",
                                         "tip": "Every 60 days in year 1, then every 90",
                                         "declined_service": "14 days after service not sold"}.get(t, t),
                       "label": t.replace("_", " ").title(), "channels": ["sms", "email"],
                       "message": _placeholdered(owner_touches.render(
                           t, first_name="Qzfirst", dealership="DEALERSHIP",
                           vehicle={"year": "YEAR", "make": "MAKE", "model": "MODEL"}, items=["ITEM"]),
                           {"Qzfirst": "{first_name}", "DEALERSHIP": "{dealership}", "YEAR MAKE MODEL": "{vehicle}",
                            "MODEL": "{model}", "ITEM": "{recommended_work}"})}
                      for t in owner_touches.ALL_TOUCHES] + [
                # Client, 21 Oct 2026: the Sold Delivered Day-3 check-in, visible and editable here like the others
                # (scheduler/sold_lifecycles.py reads it).
                {"id": "day3_checkin", "when": "Day 3 after delivery", "wait": _wait(3, "days", "start"),
                 "label": "Day 3 Check-in", "channels": ["sms", "email"],
                 "message": _placeholdered(sold_delivered.render_checkin(
                     first_name="Qzfirst", dealership="DEALERSHIP", vehicle={"year": "YEAR", "make": "MAKE",
                                                                             "model": "MODEL"},
                     first_service=None, offer_service=False),
                     {"Qzfirst": "{first_name}", "DEALERSHIP": "{dealership}", "YEAR MAKE MODEL": "{vehicle}"})},
                {"id": "recall", "when": "When an open safety recall is found for the vehicle (NHTSA)",
                 "label": "Open Recall", "channels": ["sms", "email"],
                 "message": _placeholdered(sold_delivered.render_service_outreach(
                     "recall", {"recall_id": "RECALLID", "source": "SOURCE", "component": "COMPONENT"},
                     first_name="Qzfirst", dealership="DEALERSHIP",
                     vehicle={"year": "YEAR", "make": "MAKE", "model": "MODEL"}),
                     {"Qzfirst": "{first_name}", "DEALERSHIP": "{dealership}", "YEAR MAKE MODEL": "{vehicle}",
                      "RECALLID": "{recall_id}", "SOURCE": "{recall_source}", "COMPONENT": "{recall_summary}"})}]}},
        # Client, 21 Oct 2026 (Betsy: "I don't see all the cadences I provided"): the two that ran in code only.
        {"key": "specific_followup", "name": "Contact Made - Specific Follow-Up (the customer gave a date)",
         "content": {"steps": [
             {"id": "check_back", "when": "On the date the customer asked for (their time, or this time of day)",
              "label": "Check back as they asked", "channels": ["sms", "email"],
              "wait": {"amount": 0, "unit": "days", "after": "start", "at": decide.NEXT_ACTION_DEFAULT_TIME},
              "message": ai("Say you're checking back as they asked, pick up from what they told us, and ask for the "
                            "appointment with a specific day.")},
             {"id": "no_reply", "when": "No reply within this long: back to Short-Term follow-up (No Contact Made)",
              "label": "No reply", "channels": [], "wait": _wait(int(followups.NEXT_ACTION_REPLY_WINDOW.total_seconds()
                                                                     // 3600), "hours")}]}},
        # Betsy, 21 Oct 2026 (item 8): a customer who was texting with us and stopped mid-conversation gets one
        # "still with me?" 15 minutes after the AI's question. Only then: never on a cadence touch, a "what time
        # works?" or a dated check-back (agent/turn.py). Runs in scheduler/studio_cadences.py; Off in AI Studio.
        {"key": STILL_WITH_ME, "name": "Still with me? (stopped replying mid-conversation)", "content": {
            "enabled": True, "starts_when": {"type": "ai_asked"},
            "stops_when": ["customer replies", "appointment set", "opt-out"],
            "steps": [{"id": "nudge", "when": "15 minutes after the AI asked a question, if they haven't replied",
                       "label": "Still with me?", "channels": ["sms"], "wait": _wait(15, "minutes", "start"),
                       "message": ai("They were texting with us and stopped after our question. One short, friendly "
                                     "line checking they're still there and repeating the question in a few words "
                                     "(e.g. \"Still with me? Would Saturday at 11 work?\"). No new questions.")}]}},
        {"key": "unsold", "name": "Unsold (visited, didn't buy)", "content": {
            "steps": [{"id": "first_touch", "when": "The day the manager marks the visit Unsold - then the Short-Term "
                                                    "follow-up runs again (Days 1-7, weekly, monthly)",
                       "label": "First message after the visit", "channels": ["sms", "email"],
                       "message": ai(decide.UNSOLD_INSTRUCTION)}]}},
        {"key": "appointment", "name": "Appointment: details, confirmation, no-show", "content": {
            "steps": [{"id": s, "when": w, "label": s.replace("_", " ").title(), "channels": ["sms", "email"],
                       **({"wait": {appointment.STEP_DETAILS: _wait(15, "minutes", "start"),
                                    appointment.STEP_NO_SHOW_CHECK: _wait(1, "hours", "start"),
                                    appointment.STEP_NO_SHOW_FOLLOWUP: _wait(24, "hours")}[s]}
                          if s in (appointment.STEP_DETAILS, appointment.STEP_NO_SHOW_CHECK,
                                   appointment.STEP_NO_SHOW_FOLLOWUP) else {}),
                       "message": _placeholdered(appointment.render_message(
                           s, customer_name="Qzfirst", dealership="DEALERSHIP", agent_name="AGENTNAME",
                           appt=_SAMPLE_APPT, model="MODEL", address="ADDRESS", agent_phone="PHONE"),
                           {"Qzfirst": "{first_name}", "DEALERSHIP": "{dealership}", "AGENTNAME": "{agent_name}",
                            "MODEL": "{model}", "ADDRESS": "{address}", "PHONE": "{dealer_phone}",
                            "Friday, October 16": "{date}", "2:00 PM": "{time}"})}
                      for s, w in ((appointment.STEP_DETAILS, "15 minutes after booking"),
                                   (appointment.STEP_COUNTDOWN, "Each day before"),
                                   (appointment.STEP_CONFIRM, "The day before"),
                                   (appointment.STEP_NO_SHOW_CHECK, "1 hour after, no visit"),
                                   (appointment.STEP_NO_SHOW_FOLLOWUP, "24 hours later, no reply"))]}},
    ]


def messages() -> list[dict[str, Any]]:
    mv = multi_vehicle.question_text("{first_name}", "{vehicle}")
    return [
        {"key": "after_hours_offer", "name": "After hours, outside texting hours", "content": {"message": fixed(
            "We're closed right now and open again at {opens_at}. Would you like to chat now, or would you prefer to "
            "continue during business hours?")}},
        {"key": "after_hours_closed", "name": "After hours, inside texting hours", "content": {"message": ai(
            "Say once that the dealership is closed right now and that you can help them right now, then keep going "
            "toward the appointment.")}},
        {"key": "after_hours_later", "name": "Customer chose business hours", "content": {"message": fixed(
            "Thanks, {first_name}! I'll pick this up when we open at {opens_at}.")}},
        {"key": "after_hours_resume", "name": "Morning message (we're open)", "content": {"message": fixed(
            "Good morning, {first_name}! We're open now. What day this week works best for you to come in?")}},
        {"key": "repeat_lead", "name": "Repeat lead within 30 days", "content": {"message": fixed(
            mv["sms_text"], email=mv["email_body"], subject=mv["email_subject"])}},
        {"key": "no_phone_email", "name": "First email when there's no phone number", "content": {"message": fixed(
            "Thank you for reaching out to {dealership} regarding the {vehicle}. I am excited to assist you with your "
            "purchase!\n\nWe can accomplish a lot with a quick call. What is the best phone number to reach you? We "
            "can be reached at {dealer_phone}.\n\nBy the way, what are you driving now?\n\nI look forward to hearing "
            "from you.", subject="{vehicle} Update")}},
        {"key": "safety_net", "name": "Fallback when the AI's draft fails its checks", "content": {"message": fixed(
            templates.CONTINUE_CHECKING.replace("{name}", "{first_name}"))}},
        *_template_messages(),
    ]


def _named(text: str) -> str:
    return text.replace("{name}", "{first_name}")


def _template_messages() -> list[dict[str, Any]]:
    """The fixed texts the AI sends without writing them: first replies per lead type, the holding replies while a
    person has the lead, the fallback variants, the opt-out confirmation."""
    from upsell_agent.compliance import opt_out
    rows = []
    for lead_type, t in templates.FIRST_REPLY.items():
        kind = getattr(lead_type, "value", str(lead_type))
        rows.append({"key": f"first_reply_{kind}", "name": f"Fallback first reply: {kind.replace('_', ' ')} lead",
                     "content": {"message": fixed(_named(t.sms), email=_named(t.email_body),
                                                  subject=_named(t.email_subject))}})
    for kind, t in templates.HOLDING_REPLIES.items():
        rows.append({"key": f"holding_{kind}", "name": {"holding": "While a person has the lead",
                                                        "holding_booking": "While a person has it: asked to come in",
                                                        }.get(kind, kind.replace("_", " ")),
                     "content": {"message": fixed(_named(t.sms), email=_named(t.email_body),
                                                  subject=_named(t.email_subject))}})
    rows.append({"key": "continue_noted", "name": "Fallback reply: noted", "content": {
        "message": fixed(_named(templates.CONTINUE_NOTED))}})
    for i, text in enumerate(templates.CONTINUE_VARIANTS, 1):
        rows.append({"key": f"continue_variant_{i}", "name": f"Fallback reply: variant {i}", "content": {
            "message": fixed(_named(text))}})
    rows.append({"key": "opt_out_confirmation", "name": "Opt-out confirmation", "content": {
        "message": fixed(opt_out.NL_CONFIRMATION)}})
    return rows


def _branch(when: str, then: dict[str, Any]) -> dict[str, Any]:
    return {"when": {"type": "reply", "value": when}, "then": then}


def _link(text: str) -> str:
    return text.replace(":{link}", ": {credit_app_link}").replace("{link}", " Here is a link: {credit_app_link}")


def _buyers_order_node(step: str | None, text: str) -> dict[str, Any]:
    """The client's buyer's order flow as a tree: each question, and what each answer leads to."""
    node = {"id": step or "start", "label": step.replace("_", " ").title() if step else "Ready to take delivery today?",
            "message": fixed(_link(text)), "branches": []}
    ask = buyers_order.DELIVERY if step is None else step
    for answer in ("yes", "no"):
        found = buyers_order._TEXT.get((ask, answer))
        if not found:
            continue
        reply, nxt = found
        child_text = _link(reply)
        if nxt:
            child = _buyers_order_node(nxt, child_text)
            child["id"] = f"{ask}_{answer}"
            node["branches"].append(_branch(answer, {"action": "ask", "node": child}))
        else:
            escalate = (ask, answer) == (buyers_order.CALL, "yes")
            leaf = {"id": f"{ask}_{answer}", "label": f"{ask.title()}: {answer}", "message": fixed(child_text),
                    "branches": [], "also": ["dealership_action_required"] if escalate else []}
            node["branches"].append(_branch(answer, {"action": "ask", "node": leaf}))
    node["branches"].append(_branch("anything_else", {"action": "ai"}))
    return node


def workflows() -> list[dict[str, Any]]:
    out = []
    for topic, pattern in cannot_supply._PATTERNS:
        escalates = topic in cannot_supply.ESCALATES
        name = ("Buyer's order: invite in first (appointment)" if topic == cannot_supply.BUYERS_ORDER
                else f"Can't supply: {topic.replace('_', ' ')}")
        out.append({"key": f"cannot_supply_{topic}", "name": name, "content": {
            "trigger": {"type": "customer_says", "pattern": pattern},
            "tree": {"id": "answer", "label": "Answer", "also": ["dealership_action_required"] if escalates else [],
                     "message": fixed(cannot_supply._REPLIES[topic].replace("{calculator}", " {vehicle_link}")),
                     "branches": [_branch("picks_a_time", {"action": "book"}),
                                  _branch("anything_else", {"action": "ai"})]}}})
    out.append({"key": "buyers_order", "name": "Buyer's order: if the customer insists", "content": {
        "trigger": {"type": "customer_says", "pattern": buyers_order.ASKS.pattern},
        "tree": _buyers_order_node(None, buyers_order.START)}})
    return out


def _staff_view():
    from upsell_agent.api import staff_view
    return staff_view


def status_rules() -> list[dict[str, Any]]:
    from upsell_agent.agent import crm_status, lifecycle
    return [{"key": "escalations", "name": "Dealership Action Required: when", "content": {
                "rules": [{"reason_starts_with": r, "why": w} for r, w in escalation.MANAGER_ESCALATIONS]}},
            {"key": "status_workflows", "name": "Status changed by staff -> workflow", "content": {
                "map": lifecycle.STAFF_STATUS_EVENTS}},
            {"key": "alert_kinds", "name": "Dealership Action Required: what counts", "content": {
                "counts": sorted(_staff_view().ACTION_KINDS), "kinds": _staff_view().ALERT_KINDS}},
            {"key": "ai_statuses", "name": "Statuses the AI sets", "content": {
                "stages": crm_status.CRM_STATUS_FOR_STAGE, "closings": crm_status.CRM_STATUS_FOR_EVENT}}]


def prompts() -> list[dict[str, Any]]:
    return [{"key": "compose", "name": "Writer (every customer message)",
             "content": {"text": llm.COMPOSE_INSTRUCTIONS, "editable_sections": ["WHO YOU ARE", "HOW TO WRITE"]}},
            {"key": "extract", "name": "Reader (what the customer said)",
             "content": {"text": llm.EXTRACT_INSTRUCTIONS, "editable_sections": []}}]


def _hhmm(t: Any) -> str:
    return t.strftime("%H:%M")


def _window(w: Any) -> list[str] | None:
    return [_hhmm(w[0]), _hhmm(w[1])] if w else None


def _state_row(rule: Any) -> dict[str, Any]:
    auto = rule.automated or {}
    return {"state": rule.state, "weekday": _window(rule.weekday), "saturday": _window(rule.saturday),
            "sunday": _window(rule.sunday), "holidays_banned": rule.holidays_banned,
            "cap_texts": rule.cap[0] if rule.cap else None,
            "cap_hours": int(rule.cap[1].total_seconds() // 3600) if rule.cap else None,
            "automated_weekday": _window(auto.get("weekday")), "automated_saturday": _window(auto.get("saturday")),
            "automated_sunday": _window(auto.get("sunday")),
            "automated_cap_texts": auto["cap"][0] if auto.get("cap") else None,
            "automated_cap_hours": int(auto["cap"][1].total_seconds() // 3600) if auto.get("cap") else None,
            "no_unsolicited_sales_texts": rule.unsolicited_sales_ban, "cite": rule.cite, "note": rule.note}


def _policy():
    from upsell_agent.slots import policy
    return policy


def compliance() -> list[dict[str, Any]]:
    """Client, 13 Oct 2026: "each and every rule ... add, update, delete" - the SMS / email rules too. Hours can move
    inside the federal 8 AM - 9 PM window (16 C.F.R. 310.4(c)), never past it."""
    from upsell_agent.agent.nodes import guard
    from upsell_agent.compliance import engine, opt_out, state_hours, text_consent
    from upsell_agent.guardrails import draft_guard
    return [
        {"key": "texting_hours", "name": "Texting hours & limits", "content": {
            "reply_window": _window(engine.REPLY_WINDOW), "first_message_window": _window(engine.TRANSACTIONAL_WINDOW),
            "follow_up_window": _window(engine.MARKETING_WINDOW), "follow_up_texts_per_period": engine.MARKETING_SMS_CAP,
            "period_hours": int(engine.CAP_PERIOD.total_seconds() // 3600),
            "dnd_statuses": sorted(engine.DND_STATUSES)}},
        {"key": "state_rules", "name": "State texting rules", "content": {
            "rows": [_state_row(r) for r in state_hours.STATE_RULES.values()]}},
        {"key": "opt_out", "name": "Opt-out & opt-in", "content": {
            "stop_words": sorted(opt_out.STOP_WORDS), "start_words": sorted(opt_out.START_WORDS),
            "extra_stop_phrases": [], "confirmation": opt_out.NL_CONFIRMATION,
            # Betsy, 22 Oct 2026: "don't text me" stops this inquiry; the reply and the vehicle-updates question.
            "inquiry_confirmation": opt_out.INQUIRY_CONFIRMATION,
            "vehicle_updates_question": opt_out.VEHICLE_UPDATES_QUESTION,
            "vehicle_updates_yes": opt_out.VEHICLE_UPDATES_YES,
            "inquiry_only": opt_out.INQUIRY_ONLY,
            "stop_everything_phrases": list(opt_out.STOP_EVERYTHING_PHRASES)}},
        # Betsy, 22 Oct 2026: photos and links, controlled by AutoPulse (the dealership only edits nothing here).
        {"key": "photos_and_links", "name": "Photos & links", "content": {
            "photo_on_first_message": _media().PHOTO_ON_FIRST_MESSAGE,
            "photos_when_asked": _media().PHOTOS_ON_REQUEST,
            "short_links": _short_links().ENABLED,
            **{f"share_{k}": v for k, v in _links().SHAREABLE.items()}}},
        {"key": "text_invite", "name": "Text invite (email customers)", "content": {
            "invite": text_consent.INVITE, "confirmation": text_consent.CONFIRMATION}},
        {"key": "channels", "name": "Channels: text or email first, nights", "content": {
            "first_channel": _consent().FIRST_CHANNEL, "at_night": _consent().AT_NIGHT,
            "placeholder_emails": ["no-reply", "noreply", "do-not-reply", "donotreply", "noemail", "no-email", "none",
                                   "test"]}},
        {"key": "contacted", "name": "What counts as Contacted", "content": {
            "customer_texts": 1, "customer_emails": 2,
            "note": "The lead's own arrival email counts as one of the customer's emails."}},
        {"key": "conversation_rules", "name": "Conversation rules", "content": {
            "questions_per_message": _policy().MAX_ASKS_PER_MESSAGE,
            "switch_ai_off_after_failed_drafts": guard.HANDOFF_AFTER_FAILED_DRAFTS,
            "ai_resumes_after_staff_minutes": int(followups.STAFF_QUIET_AFTER.total_seconds() // 60),
            # Betsy, 22 Oct 2026 (item 9): "I'm busy" -> what time works, and the check-back then.
            "busy_rule": _decide().BUSY_RULE, "busy_phrases": list(_decide().BUSY_PHRASES)}},
        # The user / Betsy, 25 Oct 2026: "check things at every message" - the last look before any message leaves.
        {"key": "presend_check", "name": "Last check before sending", "content": {
            "what_it_does": "Right before ANY message goes out (a reply, a follow-up, a reminder), the AI re-reads the "
                            "customer's situation fresh and stops a message that is no longer right. Nothing is "
                            "dropped: a stopped message is replaced, re-planned, or passed to staff.",
            **_presend().CHECKS,
            **{f"{k}_explained": v for k, v in _presend().EXPLAINED.items()}}},
        # The user, 26 Oct 2026: every rule set in code is shown and editable in AI Studio; the published value wins.
        {"key": "safeguards", "name": "Safeguards", "content": _safeguards()},
        {"key": "writing", "name": "Message limits & banned phrases", "content": {
            "sms_max_characters": draft_guard.SMS_MAX, "first_text_max_characters": draft_guard.TOUCH1_SMS_MAX,
            "cars_per_text": draft_guard.SMS_MAX_VEHICLES, "cars_per_email": draft_guard.EMAIL_MAX_VEHICLES,
            "banned_phrases": ["the team", "our team", "a team", "your team", "sales team", "finance team",
                               "team member", "someone from", "someone at", "someone on"],
            "banned_pattern": guard._TEAM.pattern}},
    ]


def _safeguards() -> dict[str, Any]:
    from upsell_agent import ai_studio
    mods = ai_studio._by_name()
    values = {f: getattr(mods[m], a) for f, (m, a) in ai_studio.SAFEGUARD_SWITCHES.items()}
    values.update({f: getattr(mods[m], a) for f, (m, a, _, _) in ai_studio.SAFEGUARD_NUMBERS.items()})
    explained = {
        "stop_ends_all_followups": "When a customer says stop (by text or email), the AI sends no more follow-ups on "
                                   "that inquiry on any channel - unless they keep one (\"don't email me, text is "
                                   "fine\"). Their own messages are still answered. Off: only the channel they stopped.",
        "stop_sentence_in_a_longer_message": "\"Please stop. I'll reach out when I'm coming\" counts as a stop, even "
                                             "inside a longer message.",
        "second_lead_form_counts_as_contacted": "Off (recommended): a second lead form from the same customer is a new "
                                                "inquiry, not contact - only a message from the customer makes them "
                                                "Contacted.",
        "one_conversation_per_customer": "When staff set the status of a linked duplicate lead, the status is kept, "
                                         "and the AI keeps talking to the customer on their open lead only - never "
                                         "from two leads at once.",
        "safety_net_every_lead_has_a_next_step": "Every hour, an active lead with nothing planned gets its next normal "
                                                 "follow-up (through all the usual checks). Leads with an appointment "
                                                 "or no-show on another lead are left to that workflow.",
        "no_still_with_me_after_ill_reach_out": "\"Still with me?\" isn't sent after the customer said they'll call, "
                                                "reach out or let us know.",
        "followups_sent_at_once": "How many scheduled follow-ups go out at the same time (1-10). Lower protects the CRM "
                                  "at busy times; 4 since 26 Oct.",
        "followups_per_minute": "How many scheduled follow-ups each minute's run takes (10-200); the rest go the next "
                                "minute. 40 since 26 Oct.",
        "hybrid_stock_search": "On since 27 Oct 2026 (checked on 674 real leads). Besides the usual search, the whole stock is "
                               "scored against what the customer asked for, so a car named differently from the feed "
                               "is still found (\"540\" = 5 Series 540i, \"Sonata\" = Sonata Hybrid). The AI picks "
                               "from both lists, and asks which car they mean when a few could fit.",
        "cars_from_current_search": "With the hybrid search on: how many cars come from the usual search (1-5).",
        "cars_from_new_search": "With the hybrid search on: how many more cars the new search adds (0-5).",
    }
    return {**values, **{f"{k}_explained": v for k, v in explained.items()}}


def _presend():
    from upsell_agent.channels import presend
    return presend


def _media():
    from upsell_agent.agent import vehicle_media
    return vehicle_media


def _consent():
    from upsell_agent.channels import consent
    return consent


def _short_links():
    from upsell_agent.agent import short_links
    return short_links


def _links():
    from upsell_agent.agent import link_resolver
    return link_resolver


def _decide():
    from upsell_agent.agent.nodes import decide
    return decide


LOCKED = {"prompts": ["extract"]}



# Bump when the shape of a built-in item changes: an item nobody has edited yet takes the new built-in version.
DEFAULTS_REVISION = 22


def export() -> dict[str, Any]:
    groups = {"agents": agents(), "buckets": buckets(), "sources": sources(), "cadences": cadences(),
              "messages": messages(), "workflows": workflows(), "status_rules": status_rules(), "prompts": prompts(),
              "compliance": compliance()}
    items = []
    for kind, rows in groups.items():
        for row in rows:
            items.append({"type": kind, "key": row["key"], "name": row["name"], "content": row["content"],
                          "locked": row["key"] in LOCKED.get(kind, [])})
    return {"exported_at": datetime.now(UTC).isoformat(), "revision": DEFAULTS_REVISION, "placeholders": PLACEHOLDERS,
            "items": items}


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "aiStudioDefaults.json"
    with open(out, "w") as f:
        json.dump(export(), f, indent=1, default=str)
    print(f"wrote {out}")
