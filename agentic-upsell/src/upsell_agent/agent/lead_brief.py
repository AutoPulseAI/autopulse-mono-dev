"""The lead brief: the whole picture of this lead, in one short page, for the writer (agent/nodes/compose.py).

Code decides every turn (Decide's rules, the compliance engine, the client's scripts); the model only writes. It wrote
well only when it understood the situation, and it was handed dozens of separate fields instead - so it wrote
"robotic" replies (client, 13 Oct 2026 - Betsy: "it's not speaking naturally like I would talk ... extremely
robotic"). The brief tells it, in plain words: who this customer is and how they came to us, where the lead stands,
what we know and still need, what has happened so far, why code chose this message and what this one message is
for. Nothing here decides anything; it is read-only context built from what the turn already has.
"""

from typing import Any

from upsell_agent import clock

# What each action is for - the one goal the writer is writing toward.
_GOALS = {
    "answer": "Answer their question fully and naturally, then move toward the appointment.",
    "ask": "Get the one detail we still need, asked the way a person would ask it, and say why it helps them.",
    "confirm": "Check one thing they said, lightly, then keep going.",
    "clarify": "Explain what our last question meant, simply, and ask it again.",
    "offer_visit": "Get them to pick one of the offered times. Give them a real reason to come in, from what they told us.",
    "acknowledge": "Reply warmly and briefly - no question.",
    "qualified": "Thank them and lock in the next step (the visit).",
    "partly_qualified": "Thank them; keep the door open for the visit.",
    "handoff": "Tell them, warmly, how a person will reach them.",
    "offer_human": "Offer a call or a text from a person.",
    "ask_why": "Gently find out what changed for them - one question.",
    "stop": "Nothing to write.",
}


def _first(items: list[Any] | None) -> Any:
    return items[0] if items else None


def _said(message: dict[str, Any] | None) -> str | None:
    text = str((message or {}).get("text") or "").strip()
    return text[:240] if text else None


def build(*, decision: dict[str, Any], pack: dict[str, Any], lead: dict[str, Any] | None,
          lead_state: dict[str, Any] | None, customer_text: str | None, trigger: str | None) -> dict[str, Any]:
    lead, lead_state, pack = lead or {}, lead_state or {}, pack or {}
    data = lead.get("data") or {}
    memory = pack.get("working_memory") or []
    ours = [m for m in memory if m.get("direction") == "outbound"]
    theirs = [m for m in memory if m.get("direction") == "inbound"]
    stock = pack.get("stock_search") or {}
    inventory = pack.get("inventory") or []
    visit = decision.get("visit") or {}
    bucket = decision.get("bucket") or {}
    touch = decision.get("touch") or {}
    known = [f"{k.get('label')}: {k.get('value')}" for k in (pack.get("about_customer") or {}).get("known", [])]
    started = lead_state.get("opportunity_created_at") or lead_state.get("created_at")
    day = None
    try:
        if started:
            from upsell_agent.agent.lifecycle import _aware
            day = max(1, (clock.now() - _aware(started)).days + 1)
    except Exception:  # noqa: BLE001 - a brief is never worth a failed reply
        day = None
    fired = [r for r in decision.get("rules") or [] if r.get("result") == "fired"]

    from upsell_agent.agent.multi_vehicle import vehicle_label
    vehicle = vehicle_label(lead)
    return {
        "customer": {
            "came_from": lead.get("source") or lead.get("lead_source"),
            "bucket": bucket.get("bucket") or bucket.get("name"),
            "why_they_reached_out": bucket.get("intent"),
            "what_the_lead_form_said": (str(data.get("comments") or lead.get("comments") or "").strip()[:400]
                                        or None),
            "vehicle_they_want": vehicle,
            "known_about_them": known[:12],
        },
        "where_it_stands": {
            "stage": lead_state.get("stage_label") or lead_state.get("stage"),
            "opportunity_day": f"Day {day} of 91" if day else None,
            "appointment": visit.get("display") if visit.get("status") in ("pending", "confirmed") else None,
            "offers_declined": (visit.get("attempts") if visit.get("declined") else None),
            "this_message_is": ("our first message to them" if trigger == "lead_created" and not ours
                                else f"a scheduled follow-up: {touch.get('label')}" if touch
                                else "a reply to their message" if trigger in ("inbound_message", "resume_at_opening")
                                else trigger),
        },
        "conversation_so_far": {
            "messages": len(memory),
            "our_last_message": _said(_first(list(reversed(ours)))),
            "their_last_message": customer_text or _said(_first(list(reversed(theirs)))),
        },
        "stock": {
            "exact_match": stock.get("exact") if stock else None,
            "vehicles_loaded": len(inventory),
        },
        "this_message": {
            "action": decision.get("action"),
            "why_code_chose_it": [r.get("why") for r in fired if r.get("why")][:3],
            "goal": _GOALS.get(str(decision.get("action")), "Move toward the appointment."),
        },
    }
