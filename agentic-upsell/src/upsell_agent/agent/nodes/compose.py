"""Compose (architecture §7): the AI writes the message for the step Decide
chose, as an SMS version and an email version at once (the 24h channel
switch re-sends the other version without another AI call).

It reads the turn's context pack (MASTER_PLAN_2 Phase 1), the same one
Extract read, with the profile layer brought up to date with the values
Validate just saved. It also returns what the message promises the team will
do, which the conversation state keeps.

Stronger model (MODEL_COMPOSE), 5 seconds per attempt. On a rewrite it is
told what the Guard objected to. Any failure routes the turn to the
template.
"""

import re
from datetime import date
from typing import Any

from upsell_agent.agent import human_contact
from upsell_agent.agent.context import AiBudgetExceeded, TurnContext
from upsell_agent.agent.context_pack import HELD_FROM_MODELS, profile_layer
from upsell_agent.agent.link_resolver import LinkPlan, fill_links, resolve_link
from upsell_agent.agent.llm import compose_agent, run_agent
from upsell_agent.agent.multi_vehicle import vehicle_label
from upsell_agent.agent.state import AgentState
from upsell_agent.agent.templates import first_name
from upsell_agent.agent.vehicle_media import lead_vehicle_vin, wants_link
from upsell_agent.guardrails import draft_guard
from upsell_agent.observability.trace import NodeSpan
from upsell_agent.slots.display import about_customer, display_value
from upsell_agent.slots.schema import SCHEMA

OUTPUT_TOKENS = 600


def compose_context(state: AgentState) -> dict[str, Any]:
    """The turn's context pack, with the profile layers brought up to date
    with what Validate saved this turn."""
    pack = {k: v for k, v in (state.context_pack or {}).items() if k not in HELD_FROM_MODELS}
    if state.profile:
        today = date.fromisoformat(pack["now"]["date"]) if pack.get("now") else None
        pack["profile"] = profile_layer(state.profile, today)
        pack["about_customer"] = about_customer(pack["profile"], today)
    return pack


def just_captured(state: AgentState) -> list[dict[str, str]]:
    """Values Validate saved from this message, in plain words (dates as
    "Saturday, September 27 (tomorrow)")."""
    now = (state.context_pack or {}).get("now") or {}
    today = date.fromisoformat(now["date"]) if now.get("date") else None
    validation = state.validation or {}
    return [{"label": SCHEMA[v["path"]].label, "display": display_value(SCHEMA[v["path"]], v["value"], today),
             "kind": SCHEMA[v["path"]].kind}
            for v in [*validation.get("accepted", []), *validation.get("needs_confirming", [])] if v["path"] in SCHEMA]


def _after_hours(decision: dict[str, Any]) -> dict[str, Any] | None:
    """What Compose needs of the after-hours plan (MASTER_PLAN_3 B1): which
    message this is, and when the dealership opens (None: not on record)."""
    plan = decision.get("after_hours") or {}
    if not plan.get("mode"):
        return None
    # AI Studio (client, 13 Oct 2026): the offer's question / the "closed" rule as published there.
    return {"mode": plan["mode"], "opens_at": plan.get("opens_at"),
            **{k: plan[k] for k in ("wording", "instruction") if plan.get(k)}}


_BUILT_IN_OFFER = re.compile(r"\s*(?:We're closed right now[^?]*?\.\s*)?Would you like to chat now[^?]*\?", re.IGNORECASE)


def place_after_hours_wording(draft: dict[str, Any], decision: dict[str, Any]) -> bool:
    """The after-hours offer's question as published in AI Studio ends the message, in place of the built-in one."""
    plan = decision.get("after_hours") or {}
    wording = plan.get("wording") if plan.get("mode") == "offer" else None
    if not wording or decision.get("reply_language"):
        return False
    for key in ("sms_text", "email_body"):
        text = _BUILT_IN_OFFER.sub("", str(draft.get(key) or "")).rstrip()
        if wording not in text:
            text = f"{text} {wording}".strip() if key == "sms_text" else f"{text}\n\n{wording}".strip()
        draft[key] = text
    return True


_SALUTATION_LINE = re.compile(r"^\s*(?:hello|hi|hey|dear|good (?:morning|afternoon|evening))\b[^\n]{0,40}\n+",
                              re.IGNORECASE)
_THANKS_OPENING = re.compile(r"^\s*(?:thanks|thank you)(?: so much)? for (?:reaching out|getting in touch|your interest|"
                             r"contacting (?:us|our [\w ]+?)|your inquiry|your message)[^.!?\n]*[.!]\s*", re.IGNORECASE)


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def place_touch1_intro(draft: dict[str, Any], intro: str | None) -> list[str]:
    """PLAN_4 stream Q: Touch 1's required opening is fixed text, so code puts it first when the model didn't.
    Seen with gpt-5-mini on most first replies (the stream E/Q runs): the email opened "Hello Ray,\\n\\n" and then
    left the intro out or reworded it, the guard's touch1_opening_first check failed twice and the lead went to
    staff with the generic template. A leading salutation line, any copy of the intro's sentences and an opening
    "Thanks for reaching out." (the intro already thanks them) are removed, then the intro goes first.
    Changes `draft` in place; returns which versions were changed (for the trace)."""
    if not intro:
        return []
    intro = intro.strip()
    first = _sentences(intro)[0] if _sentences(intro) else intro
    # "Hello Ray, greetings from ..." also appears without its greeting ("Greetings from ...").
    pieces = [*_sentences(intro), first.split(", ", 1)[1] if ", " in first else first]
    changed = []
    for name, key, gap in (("SMS", "sms_text", " "), ("email", "email_body", "\n\n")):
        text = str(draft.get(key) or "")
        if not text.strip() or text.lstrip().startswith(intro):
            continue
        text = _SALUTATION_LINE.sub("", text, count=1)
        for piece in sorted(pieces, key=len, reverse=True):
            text = re.sub(re.escape(piece) + r"\s*", "", text, flags=re.IGNORECASE)
        text = _THANKS_OPENING.sub("", text, count=1).strip()
        draft[key] = f"{intro}{gap}{text}".rstrip() if text else intro
        changed.append(name)
    return changed


def _without_own_price(text: str, price_line: str | None) -> str:
    """Client, 16 Oct 2026 (George's first text said the price twice): code places her price line, so a sentence the
    model wrote with the same price is dropped."""
    price = re.search(r"\$\d[\d,]*\d", price_line or "")
    if not price or text.count(price.group(0)) < 1:
        return text
    sentences = re.split(r"(?<=[.!?])\s+", text)
    kept = [s for s in sentences if price.group(0) not in s or s.strip() == (price_line or "").strip()]
    return " ".join(kept)


def place_touch1_extras(draft: dict[str, Any], touch1: dict[str, Any] | None) -> list[str]:
    """Client, 12 Oct 2026 (Betsy): the first reply about an in-stock vehicle carries its listed price (tax,
    documentation and DMV not included) and its photo, right after the introduction; a customer with no phone gets
    her email asking for one. Placed by code, like the introduction. Returns what was placed (for the trace)."""
    touch1 = touch1 or {}
    placed: list[str] = []
    line = " ".join(p for p in (touch1.get("price_line"), touch1.get("lead_answers")) if p) or None
    vin, intro = touch1.get("vin"), str(touch1.get("intro") or "").strip()
    if line and vin:
        for key, vins, media in (("sms_text", "sms_vins", "sms_media_vin"), ("email_body", "email_vins",
                                                                             "email_media_vin")):
            text = _without_own_price(str(draft.get(key) or ""), touch1.get("price_line"))
            if line not in text:
                text = (f"{intro} {line}{text[len(intro):]}" if intro and text.startswith(intro)
                        else f"{line} {text}").replace("  ", " ")
                draft[key] = text
            draft[vins] = list(dict.fromkeys([vin, *(draft.get(vins) or [])]))
            draft[media] = vin
        placed.append("the vehicle's facts and photo")
    email = touch1.get("no_phone_email")
    if email:
        # The FTC introduction first ("needs to be said BEFORE ANYTHING", 7 Oct 2026; "email should follow all same
        # rules as SMS", 12 Oct 2026), then her no-phone email without its own greeting line.
        body = email["body"]
        if intro:
            body = f"{intro}\n\n{body.split(chr(10) + chr(10), 1)[1] if chr(10) + chr(10) in body else body}"
        draft["email_subject"], draft["email_body"] = email["subject"], body
        placed.append("no-phone email")
    return placed


def place_fixed_text(draft: dict[str, Any], fixed_text: str | None, customer_first_name: str | None,
                     vehicle: str | None = None, *, nudge: bool = True) -> bool:
    """Touch 2's name nudge (decide.py plan_cadence_touch_context: "the client calls it non-negotiable",
    Omnichannel PDF §3) is overwritten here rather than trusted to the model, the same reasoning as Touch 1's
    intro (place_touch1_intro): seen live, 6 Oct 2026, gpt-5-mini wrote a full qualifying question instead of
    "Nina?" even though Compose was told, in so many words, to send exactly that and nothing else. Any other
    cadence touch with a fixed_text would get the same treatment; today only the name nudge has one. Changes
    `draft` in place; returns whether it actually changed anything (for the trace)."""
    if not fixed_text:
        return False
    changed = str(draft.get("sms_text") or "") != fixed_text
    name = first_name(customer_first_name) or "there"
    draft["sms_text"] = fixed_text
    draft["email_subject"] = draft.get("email_subject") or "Your inquiry"
    # "{FirstName}?" is a text; as an email it read "Hi Domenico, Domenico? Thanks, The Team" (seen live, 11 Oct
    # 2026). The email says the same thing in a sentence.
    about = f" about the {vehicle}" if vehicle else ""
    draft["email_subject"] = "Just checking in"
    draft["email_body"] = (f"Hi {name},\n\nJust checking that you saw my last message{about}. Is there anything I can "
                           f"help you with?\n\nThank you") if nudge else f"Hi {name},\n\n{fixed_text}\n\nThank you"
    draft["promises"] = []
    return changed


def place_cannot_supply(draft: dict[str, Any], cannot: dict[str, Any] | None, customer_first_name: str | None,
                        allowed_urls: list[str] | None = None) -> bool:
    """Client, 12 Oct 2026 (Betsy): what the AI can't supply (credit score, APR, payment, custom photos/video,
    out-the-door price, out of state) is answered in her words exactly (agent/cannot_supply.py) - written here, not
    by the model. Its time choices are the visit offer Decide recorded, so a pick books. Returns whether it placed."""
    if not cannot or not cannot.get("text"):
        return False
    text = str(cannot["text"])
    name = first_name(customer_first_name) or "there"
    draft["sms_text"] = text
    draft["email_subject"] = draft.get("email_subject") or "Your inquiry"
    draft["email_body"] = f"Hi {name},\n\n{text}\n\nThank you"
    draft["promises"] = []
    draft["sms_vins"], draft["email_vins"] = [], []
    draft["sms_text_no_vehicles"] = draft["email_body_no_vehicles"] = draft["email_subject_no_vehicles"] = None
    url = next((u for u in re.findall(r"https?://\S+", text)), None)
    if url and allowed_urls is not None:
        allowed_urls.append(url.rstrip("."))
    return True


def plan_links(state: AgentState, ctx: TurnContext | None = None) -> LinkPlan:
    """This turn's link plan (agent/link_resolver.py), from what Extract said and this turn's stock."""
    pack = state.context_pack or {}
    info = (pack.get("dealer") or {}).get("info") or {}
    lead_vin = lead_vehicle_vin(ctx.lead, ctx.lead_state) if ctx else None
    if (state.decision or {}).get("touch1") and lead_vin:
        # Client, 12 Oct 2026 (Betsy): "if there is a vehicle of interest in the lead, the AI should send an image
        # or link to the vehicle and name it" - the first reply carries that vehicle's page when it's in stock.
        record = next((r for r in pack.get("inventory") or [] if r.get("vin") == lead_vin), None)
        page = str((record or {}).get("page_url") or "").strip()
        if page:
            from upsell_agent.agent.link_resolver import LinkPlan, _describe
            return LinkPlan(kind="vehicle", vin=lead_vin, description=_describe(record), vehicle_url=page,
                            confidence=1.0, reasons=["First reply: the vehicle the lead is about, in stock: its page."])
    return resolve_link(state.extraction, inventory=pack.get("inventory") or [], website=info.get("website"),
                        # Dealer Setup's own pages (client, 8 Oct 2026; integrations/dealer_profile.py).
                        dealer_links={"credit_application": info.get("credit_application_link"),
                                      "trade_in": info.get("trade_in_link")},
                        referred_vin=(pack.get("referred_vehicle") or {}).get("vin"),
                        lead_vin=lead_vin)


def compose_payload(state: AgentState, link_plan: LinkPlan | None = None,
                    ctx: TurnContext | None = None) -> dict[str, Any]:
    decision = state.decision or {}
    from upsell_agent.agent import lead_brief
    return {
        # Client, 13 Oct 2026: the whole picture first, so the writer knows where this lead came from, where it
        # stands, what happened so far and what this one message is for (agent/lead_brief.py).
        "brief": lead_brief.build(decision=decision, pack=state.context_pack or {}, lead=ctx.lead if ctx else None,
                                  lead_state=ctx.lead_state if ctx else None,
                                  customer_text=state.customer_text or state.inbound_text, trigger=state.trigger),
        "action": decision.get("action"),
        "asks": [{"label": a["label"], "question": a.get("question") or a["hint"], "explanation": a.get("explanation", "")}
                 for a in decision.get("asks", [])],
        "confirm": decision.get("confirm"),
        "clarify": decision.get("clarify"),
        "answer_questions": decision.get("answer_questions", []),
        "annoyed_at_bot": bool(decision.get("annoyed_at_bot")),
        "hold_questions": decision.get("hold_questions"),
        "quiet_hours": decision.get("quiet_hours"),
        "after_hours": _after_hours(decision),
        # MASTER_PLAN_3 B4/B5: the offer to present (only when Decide fired one this turn), and
        # the lead's current visit/booking state (for wording that matches a real booking, decision 60).
        "visit_offer": decision.get("visit_offer"),
        "visit": decision.get("visit"),
        # PLAN_4 stream Q: buying urgency drives the appointment (agent/nodes/decide.py urgency), never a handoff.
        "urgency": decision.get("urgency"),
        "reply_language": decision.get("reply_language"),
        # MASTER_PLAN_4 A1: the lead bucket's intent and word-track emphasis (blueprint §2) - language only.
        "bucket": decision.get("bucket"),
        # Client, 8 Oct 2026: the specialist answering this turn (agent/specialists.py).
        "specialist": decision.get("specialist"),
        "departments": decision.get("departments"),
        # MASTER_PLAN_3 C3: a dated next step to confirm back, and (on a scheduled next-step turn)
        # that we're checking back as they asked.
        # MASTER_PLAN_3 C4: Touch 1's required opening and closing, and the cadence touch's theme.
        "touch1": decision.get("touch1"),
        "ask_name": bool(decision.get("ask_name")),
        "touch": decision.get("touch"),
        "next_action": ({"display": decision["next_action"]["display"]} if decision.get("next_action") else None),
        # MASTER_PLAN_4 F3 / conversation_7: which link placeholder(s) to write, if any (agent/link_resolver.py).
        "link_requested": wants_link(state.extraction),
        "link": link_plan.for_compose() if link_plan else None,
        "reach_out": decision.get("reach_out"),
        # PLAN_4 stream H: "speak to a person" - offer a call or a text, or say how they'll be contacted.
        # Never the full phone number: its last 4 digits only (agent/human_contact.for_compose).
        "human_contact": human_contact.for_compose(decision.get("human_contact")),
        "customer_first_name": first_name(state.customer_name),
        "channel": state.channel,
        "campaign": state.campaign,
        "customer_text": state.customer_text or state.inbound_text,
        "attempt": state.retry_count + 1,
        "guard_feedback": (state.guard_result or {}).get("violations", []) if state.retry_count else [],
        "just_captured": just_captured(state),
        "context": compose_context(state),
    }


# DEV-only test tags (scenarios/, the Debug UI, a few unit tests), honoured here rather than inside any one
# model, so the guard / rewrite / fallback / deadline paths run the same way whichever model is configured -
# offline or real (previously only the offline stand-in understood them, so a scenario using one "passed" by
# luck or failed outright once the AI service pointed at a real model). Never active outside ENVIRONMENT=DEV,
# and nothing a real customer would plausibly type:
#   #slow      compose never calls the model (a real one can't be told to hang on command) and goes straight
#              through the same path a genuine timeout takes, so the turn's deadline sends the template.
#   #retry     the real draft gets an invented offer stitched on, on attempt 1 only, so the guard sends it
#              back once and the rewrite (attempt 2, no hint) passes clean.
#   #fallback  the same invented offer is stitched on every attempt, so both fail the guard and the fallback
#              template is used.
#   #badtrim   the real draft gets a trim stitched on that isn't the named vehicle's real one, on attempt 1
#              only, to exercise the grounding check the same way.
DEV_HINT_OFFER = " Plus $500 off, guaranteed!"


def _dev_hints(state: AgentState, ctx: TurnContext) -> tuple[bool, bool, bool, bool]:
    """(slow, retry, fallback, badtrim): which dev tag, if any, the customer's own message carries."""
    if not ctx.settings.is_dev:
        return False, False, False, False
    text = (state.customer_text or state.inbound_text or "").lower()
    return "#slow" in text, "#retry" in text, "#fallback" in text, "#badtrim" in text


def _apply_dev_hint(draft: dict[str, Any], payload: dict[str, Any], *, retry: bool, fallback: bool,
                    badtrim: bool) -> str | None:
    """Corrupts an otherwise-real draft in place so the guard has something true to catch. Returns a trace
    line, or None if neither tag was present."""
    attempt = payload["attempt"]
    if fallback or (retry and attempt == 1):
        for key in ("sms_text", "email_body"):
            if draft.get(key):
                draft[key] = draft[key].rstrip() + DEV_HINT_OFFER
        return "Dev hint: an invented offer was added on purpose to exercise the guard."
    if badtrim and attempt == 1 and draft.get("sms_vins"):
        vin = draft["sms_vins"][0]
        vehicle = next((v for v in (payload.get("context") or {}).get("inventory") or []
                        if v.get("vin") == vin or v.get("source_id") == vin), None)
        if vehicle:
            real_trim = str(vehicle.get("trim") or "").strip().lower()
            fake = "Limited" if real_trim != "limited" else "Sport"
            for key in ("sms_text", "email_body"):
                if draft.get(key):
                    draft[key] = draft[key].rstrip() + f" It comes in the {fake} trim."
            return f"Dev hint: claimed the {fake} trim, which isn't on this vehicle, to exercise the grounding check."
    return None


async def compose(state: AgentState, span: NodeSpan, ctx: TurnContext) -> dict[str, Any]:
    model = ctx.settings.model_compose
    link_plan = plan_links(state, ctx)
    payload = compose_payload(state, link_plan, ctx)
    span.metrics = {"model": model}
    slow, retry, fallback, badtrim = _dev_hints(state, ctx)
    if slow:
        return _failed(span, f"no answer within {ctx.settings.compose_timeout_s}s (dev hint: #slow)")
    try:
        ctx.spend_ai_call()
        result, call = await run_agent(compose_agent(model), model, payload,
                                       timeout_s=ctx.settings.compose_timeout_s, output_tokens_limit=OUTPUT_TOKENS)
    except TimeoutError:
        return _failed(span, f"no answer within {ctx.settings.compose_timeout_s}s")
    except AiBudgetExceeded as exc:
        return _failed(span, str(exc))
    except Exception as exc:  # noqa: BLE001 - any model/provider error sends the template
        return _failed(span, f"{type(exc).__name__}: {exc}")

    draft = {**result.model_dump(), "attempt": payload["attempt"]}
    ctx.model_calls.append({"step": "compose", **call.as_metrics()})
    placed = place_touch1_intro(draft, ((state.decision or {}).get("touch1") or {}).get("intro"))
    extras = place_touch1_extras(draft, (state.decision or {}).get("touch1"))
    scripted = place_cannot_supply(draft, (state.decision or {}).get("cannot_supply"), state.customer_name)
    place_after_hours_wording(draft, state.decision or {})
    touch_ = (state.decision or {}).get("touch") or {}
    nudged = place_fixed_text(draft, touch_.get("fixed_text"), state.customer_name,
                              vehicle=vehicle_label(ctx.lead) if ctx else None, nudge=touch_.get("theme") == "name_nudge")
    hinted = _apply_dev_hint(draft, payload, retry=retry, fallback=fallback, badtrim=badtrim)
    decision = state.decision or {}
    linked = fill_links(draft, link_plan, sms_limit=draft_guard.TOUCH1_SMS_MAX if decision.get("touch1") or
                        decision.get("reply_language") else draft_guard.SMS_MAX)
    draft["link_plan"] = link_plan.as_dict()
    placed_text = " ".join(str(t or "") for t in (((decision.get("cannot_supply") or {}).get("text") if scripted else ""),
                                                  ((decision.get("touch1") or {}).get("lead_answers") if extras else "")))
    if placed_text.strip():
        # Only the vehicle's own page that code placed (a can't-supply calculator link, a first-reply answer): allowed.
        draft["link_plan"]["urls"] = [*draft["link_plan"].get("urls", []),
                                      *(u.rstrip(".") for u in re.findall(r"https?://\S+", placed_text))]
    span.output = draft
    span.metrics = call.as_metrics()
    span.reasoning = [draft["why"]]
    if extras:
        span.reasoning.append("First reply: " + " and ".join(extras) + " placed by code (client, 12 Oct 2026).")
    if scripted:
        span.reasoning.append(f"Can't-supply reply ({decision['cannot_supply']['topic']}) placed by code, in the "
                              "client's words.")
    if placed:
        span.reasoning.append("Touch 1's required opening put first by code in the " + " and ".join(placed) + ".")
    if nudged:
        span.reasoning.append("The client's exact fixed wording put in by code, replacing the model's own draft.")
    if hinted:
        span.reasoning.append(hinted)
    span.reasoning += [f"Link: {r}" for r in link_plan.reasons] + linked
    if draft.get("promises"):
        span.reasoning.append("Promises the team: " + "; ".join(draft["promises"]))
    if payload["guard_feedback"]:
        span.reasoning.append("Rewrite after the guard objected to: " + "; ".join(payload["guard_feedback"]))
    if state.campaign:
        span.reasoning.append(f"Replying in the context of the campaign '{state.campaign['name']}'.")
    span.edge_label = f"draft {payload['attempt']}"
    return {"draft": draft}


def _failed(span: NodeSpan, reason: str) -> dict[str, Any]:
    span.output = {"error": reason}
    span.reasoning = [f"Compose failed: {reason}. Sending the template instead."]
    span.edge_label = "failed"
    return {"draft": None, "fallback_reason": f"compose failed: {reason}"}
