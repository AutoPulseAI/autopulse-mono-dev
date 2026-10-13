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
    sold_pending,
    specialists,
    templates,
)
from upsell_agent.compliance import origin

PLACEHOLDERS = {
    "first_name": "Customer's first name", "dealership": "Dealership name", "agent_name": "AI agent's name",
    "vehicle": "Year, make and model", "model": "Vehicle model", "price": "Listed price", "times": "Two open times",
    "date": "Appointment date", "time": "Appointment time", "address": "Dealership address",
    "ask_for": "Who to ask for (assigned salesperson)", "dealer_phone": "Dealership phone",
    "credit_app_link": "Credit application link", "vehicle_link": "Vehicle page link", "opens_at": "When we open", "recommended_work": "Work the technicians recommended",
}
_SAMPLE_APPT = datetime(2026, 10, 16, 14, 0, tzinfo=UTC)


def fixed(text: str, *, email: str | None = None, subject: str | None = None) -> dict[str, Any]:
    return {"mode": "fixed", "text": text, "email_text": email, "email_subject": subject, "instruction": None,
            "fallback": None}


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


def _theme_step(day: int | str, theme: cadence.Theme, when: str) -> dict[str, Any]:
    return {"id": theme.id, "day": day, "when": when, "label": theme.label, "channels": ["sms", "email", "call_task"],
            "message": ai(theme.instruction)}


def cadences() -> list[dict[str, Any]]:
    sales_steps = [
        {"id": "touch1", "day": 1, "when": "Immediately (or the next allowed time)", "label": "First message (FTC)",
         "channels": ["sms", "email"], "message": {
             **fixed("Hi {first_name}, this is {agent_name}, {dealership}'s AI Sales Manager, following up on your "
                     "interest in the {vehicle}. {price_line} Tell me, what are you driving now?"),
             "mode": "fixed_opening_ai",
             "instruction": "Answer what the lead form asked (mileage, CARFAX, availability) between the opening and "
                            "the closing question."}},
        {"id": cadence.NAME_NUDGE.id, "day": 1, "when": "3 hours after the first message", "label": "Name nudge",
         "channels": ["sms", "email"],
         "message": fixed("{first_name}?", email="Hi {first_name},\n\nJust checking that you saw my last message about "
                                                 "the {vehicle}. Is there anything I can help you with?\n\nThank you",
                          subject="Just checking in")},
        *[_theme_step(i + 2, t, f"Day {i + 2}") for i, t in enumerate(cadence.DAY_THEMES)],
    ]
    return [
        {"key": "sales_days_1_7", "name": "Sales follow-up: Days 1-7", "content": {"steps": sales_steps,
         "stops_when": ["customer replies", "appointment set", "opt-out", "sales visit"]}},
        {"key": "sales_days_8_30", "name": "Sales follow-up: Days 8-30 (weekly)", "content": {
            "every": "7 days", "steps": [_theme_step("8-30", t, "Weekly") for t in cadence.NURTURE_THEMES]}},
        {"key": "sales_days_31_90", "name": "Sales follow-up: Days 31-90 (every 2 weeks)", "content": {
            "every": "14 days", "steps": [_theme_step("31-90", t, "Every 2 weeks") for t in cadence.DEEPER_THEMES],
            "day_91": "The opportunity closes (Closed - Lost); the customer stays in the CRM."}},
        {"key": "sold_pending", "name": "Sold Pending", "content": {
            "steps": [{"id": f"week_{n}", "when": f"Touch {n} (day {sold_pending.touch_due_day(n)})",
                       "label": sold_pending.theme_for(n).label if hasattr(sold_pending.theme_for(n), "label") else
                       f"Touch {n}", "channels": ["sms", "email", "call_task"],
                       "message": _placeholdered(sold_pending.render_touch(
                           n, first_name="Qzfirst", dealership="DEALERSHIP", vehicle="VEHICLE", documents=n == 1),
                           {"Qzfirst": "{first_name}", "DEALERSHIP": "{dealership}", "VEHICLE": "{vehicle}"})}
                      for n in range(1, 7)]}},
        {"key": "owner_lifecycle", "name": "Sold Delivered: owner lifecycle", "content": {
            "steps": [{"id": t, "when": {"review_referral": "Day 14", "first_30": "Day 30", "first_90": "About day 90",
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
                      for t in owner_touches.ALL_TOUCHES]}},
        {"key": "appointment", "name": "Appointment: details, confirmation, no-show", "content": {
            "steps": [{"id": s, "when": w, "label": s.replace("_", " ").title(), "channels": ["sms", "email"],
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
    ]


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
        out.append({"key": f"cannot_supply_{topic}", "name": f"Can't supply: {topic.replace('_', ' ')}", "content": {
            "trigger": {"type": "customer_says", "pattern": pattern},
            "tree": {"id": "answer", "label": "Answer", "also": ["dealership_action_required"] if escalates else [],
                     "message": fixed(cannot_supply._REPLIES[topic].replace("{calculator}", " {vehicle_link}")),
                     "branches": [_branch("picks_a_time", {"action": "book"}),
                                  _branch("anything_else", {"action": "ai"})]}}})
    out.append({"key": "buyers_order", "name": "Buyer's order", "content": {
        "trigger": {"type": "customer_says", "pattern": buyers_order.ASKS.pattern},
        "tree": _buyers_order_node(None, buyers_order.START)}})
    return out


def status_rules() -> list[dict[str, Any]]:
    from upsell_agent.agent import crm_status, lifecycle
    return [{"key": "escalations", "name": "Dealership Action Required: when", "content": {
                "rules": [{"reason_starts_with": r, "why": w} for r, w in escalation.MANAGER_ESCALATIONS]}},
            {"key": "status_workflows", "name": "Status changed by staff -> workflow", "content": {
                "map": lifecycle.STAFF_STATUS_EVENTS}},
            {"key": "ai_statuses", "name": "Statuses the AI sets", "content": {
                "stages": crm_status.CRM_STATUS_FOR_STAGE, "closings": crm_status.CRM_STATUS_FOR_EVENT}}]


def prompts() -> list[dict[str, Any]]:
    return [{"key": "compose", "name": "Writer (every customer message)",
             "content": {"text": llm.COMPOSE_INSTRUCTIONS, "editable_sections": ["WHO YOU ARE", "HOW TO WRITE"]}},
            {"key": "extract", "name": "Reader (what the customer said)",
             "content": {"text": llm.EXTRACT_INSTRUCTIONS, "editable_sections": []}}]


LOCKED = {"prompts": ["extract"]}


# Bump when the shape of a built-in item changes: an item nobody has edited yet takes the new built-in version.
DEFAULTS_REVISION = 3


def export() -> dict[str, Any]:
    groups = {"agents": agents(), "buckets": buckets(), "sources": sources(), "cadences": cadences(),
              "messages": messages(), "workflows": workflows(), "status_rules": status_rules(), "prompts": prompts()}
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
