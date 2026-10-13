"""AI Studio, connected (client, 13 Oct 2026: "the back end will go dynamic ... updated, added, deleted").

Each test publishes a setting the way the CRM's AI Studio does (ai_config_items / ai_config_versions), then runs a
real conversation: the customer gets what was published; a draft, the built-in version, a reset and a broken item
change nothing.
"""

import copy

import pytest
from bson import ObjectId

from tests.unit.test_booking_flow import _last_sms, _say
from tests.unit.test_client_requirements import RAV4, _new_lead, _sent
from tests.unit.test_inventory_tool import _stock, _vehicle
from upsell_agent import ai_studio
from upsell_agent.agent import cannot_supply, escalation, specialists
from upsell_agent.compliance import origin

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")


def _default(kind: str, key: str) -> dict:
    return copy.deepcopy(ai_studio._built_in()[(kind, key)])


async def _publish(mongo, kind: str, key: str, content: dict, *, note: str = "Edited in AI Studio",
                   status: str = "published", deleted: bool = False) -> None:
    """What the CRM writes: the item, its built-in version 1, and this version 2."""
    item_id = ObjectId()
    published = 2 if status == "published" else 1
    await mongo.ai_config_items.insert_one({"_id": item_id, "type": kind, "key": key, "dealer_id": None,
                                            "published_version": published, "draft_version": 2 if status == "draft"
                                            else None, "deleted": deleted})
    if (kind, key) in ai_studio._built_in():
        await mongo.ai_config_versions.insert_one({"item_id": item_id, "version": 1, "status": "published",
                                                   "content": _default(kind, key),
                                                   "note": "Built-in setting (what the AI does today)"})
    await mongo.ai_config_versions.insert_one({"item_id": item_id, "version": 2, "status": status,
                                               "content": content, "note": note})
    await ai_studio.refresh(force=True)


def _tree_text(content: dict, text: str) -> dict:
    content["tree"]["message"]["text"] = text
    return content


# --- Edits reach the customer -------------------------------------------------------------------------------------

async def test_an_edited_script_is_what_the_customer_gets(mongo):
    await _publish(mongo, "workflows", "cannot_supply_apr", _tree_text(
        _default("workflows", "cannot_supply_apr"),
        "Rates depend on the lender, so our finance manager will get you the best one. Can you come in {times}?"))
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "What's the APR?")
    reply = await _last_sms(mongo, created)
    assert reply.startswith("Rates depend on the lender, so our finance manager will get you the best one.")
    assert " or " in reply and "{times}" not in reply  # two real open times


async def test_reset_to_default_puts_the_built_in_back(mongo):
    await _publish(mongo, "workflows", "cannot_supply_apr", _default("workflows", "cannot_supply_apr"),
                   note="Reset to the AutoPulse default")
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "What's the APR?")
    assert (await _last_sms(mongo, created)).startswith("Our goal is to get you the lowest possible APR")


async def test_a_draft_never_reaches_a_customer(mongo):
    await _publish(mongo, "workflows", "cannot_supply_apr", _tree_text(
        _default("workflows", "cannot_supply_apr"), "DRAFT TEXT {times}"), status="draft")
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "What's the APR?")
    assert "DRAFT" not in await _last_sms(mongo, created)


async def test_an_edited_buyers_order_step(mongo):
    content = _default("workflows", "buyers_order")
    content["tree"]["message"]["text"] = "Great! Are you ready to pick it up today?"
    yes = content["tree"]["branches"][0]["then"]["node"]
    yes["message"]["text"] = "Wonderful. Do you have a car to trade in?"
    await _publish(mongo, "workflows", "buyers_order", content)
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Can you send me a buyer's order?")
    assert await _last_sms(mongo, created) == "Great! Are you ready to pick it up today?"
    await _say(created, "yes")
    assert await _last_sms(mongo, created) == "Wonderful. Do you have a car to trade in?"
    await _say(created, "yes")
    assert "we must appraise your trade-in first" in await _last_sms(mongo, created)  # the step not edited


async def test_the_repeat_lead_question_as_published(mongo):
    content = _default("messages", "repeat_lead")
    content["message"]["text"] = "Welcome back, {first_name}! Still looking at the {vehicle}, or something else too?"
    await _publish(mongo, "messages", "repeat_lead", content)
    first = await _new_lead(mongo, vehicle=RAV4)
    second = await _new_lead(mongo, vehicle={"year": 2023, "make": "Toyota", "model": "RAV4"},
                             customer_id=first["customer_id"])
    texts = await _sent(mongo, first) + await _sent(mongo, second)
    assert "Welcome back, Maria! Still looking at the 2023 Toyota RAV4, or something else too?" in texts


async def test_the_first_message_as_published_keeps_the_price_and_photo(mongo):
    content = _default("cadences", "sales_days_1_7")
    content["steps"][0]["message"]["text"] = ("Hello {first_name}, I'm {dealership}'s AI Sales Manager, about the "
                                              "{vehicle}. {price_line} What do you drive today?")
    await _publish(mongo, "cadences", "sales_days_1_7", content)
    await _stock(mongo, _vehicle("VIN0000000000CR01"))
    created = await _new_lead(mongo, vehicle=RAV4)
    first = (await _sent(mongo, created))[0]
    assert first.startswith("Hello Maria, I'm ") and "AI Sales Manager, about the 2022 Honda CR-V." in first
    assert "$27,995, not including tax, documentation and DMV fees" in first
    assert "What do you drive today?" in first and "Tell me, what are you driving now?" not in first


# --- Added and deleted ----------------------------------------------------------------------------------------------

async def test_an_added_one_step_workflow_answers_and_offers_times(mongo):
    content = {"trigger": {"type": "customer_says", "phrases": ["warranty", "extended warrant…"]},
               "tree": {"id": "answer", "label": "Answer", "also": [],
                        "message": {"mode": "fixed", "text": "Every car comes with a 90-day warranty, and we can go "
                                                             "over extended plans in person. I have {times} available."},
                        "branches": [{"when": {"type": "reply", "value": "picks_a_time"}, "then": {"action": "book"}}]}}
    await _publish(mongo, "workflows", "warranty", content)
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Does it come with a warranty?")
    reply = await _last_sms(mongo, created)
    assert reply.startswith("Every car comes with a 90-day warranty") and "{times}" not in reply
    await _say(created, "the first one works")
    assert "all set" in (await _last_sms(mongo, created)).lower()


async def test_an_added_yes_no_workflow_runs_step_by_step(mongo):
    ask = lambda nid, text, branches=None: {"id": nid, "label": nid, "message": {"mode": "fixed", "text": text},
                                            "branches": branches or []}
    tree = ask("start", "Happy to help with a lease! Do you have a lease ending soon?", [
        {"when": {"type": "reply", "value": "yes"}, "then": {"action": "ask", "node": ask(
            "ending", "Great, is it with us?", [
                {"when": {"type": "reply", "value": "yes"}, "then": {"action": "ask", "node": {
                    **ask("ours", "Perfect, I'll have our lease manager call you."),
                    "also": ["dealership_action_required"]}}}])}},
        {"when": {"type": "reply", "value": "no"}, "then": {"action": "ask", "node": ask(
            "new", "No problem. What payment range are you comfortable with?")}}])
    await _publish(mongo, "workflows", "lease_return",
                   {"trigger": {"type": "customer_says", "words": ["lease return", "lease ending"]}, "tree": tree})
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "I have a question about a lease return")
    assert await _last_sms(mongo, created) == "Happy to help with a lease! Do you have a lease ending soon?"
    await _say(created, "yes")
    assert await _last_sms(mongo, created) == "Great, is it with us?"
    await _say(created, "yes")
    assert await _last_sms(mongo, created) == "Perfect, I'll have our lease manager call you."
    from upsell_agent.integrations.mongodb import AI_LEAD_STATE_COLLECTION
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["crm_status_sync"]["crm_status"] == "Managerial Review"


async def test_a_deleted_workflow_stops(mongo):
    await _publish(mongo, "workflows", "warranty", {"trigger": {"words": ["warranty"]}, "tree": {
        "id": "a", "message": {"mode": "fixed", "text": "WARRANTY SCRIPT"}, "branches": []}}, deleted=True)
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Does it come with a warranty?")
    assert "WARRANTY SCRIPT" not in await _last_sms(mongo, created)


async def test_an_added_agent_takes_over_on_its_words(mongo):
    await _publish(mongo, "agents", "ev", {"name": "EV specialist", "playbook": "Talk about charging and range.",
                                           "never": "Never promise a range.", "keywords": ["charging", "range"]})
    picked, why = specialists.route("How long does charging take?")
    assert picked.id == "ev" and "charging" in why
    assert specialists.route("What's my trade worth?")[0].id == specialists.TRADE  # the others still work


async def test_an_agent_keyword_added_to_a_built_in_agent(mongo):
    content = _default("agents", "trade")
    from upsell_agent.devtools.export_ai_config import agents  # noqa: F401 - shape check only
    content["keywords"] = ["trade-in", "my car worth", "swap my car"]
    await _publish(mongo, "agents", "trade", content)
    assert specialists.route("Can I swap my car for this one?")[0].id == specialists.TRADE


async def test_an_added_lead_source_is_inbound(mongo):
    content = _default("sources", "inbound_sources")
    content["sources"] = ["website", "dealer inspire", "zebra leads"]
    await _publish(mongo, "sources", "inbound_sources", content)
    assert origin.INBOUND_SOURCES.search("zebra leads") and not origin.INBOUND_SOURCES.search("cargurus")


async def test_removing_an_escalation_rule(mongo):
    content = _default("status_rules", "escalations")
    content["rules"] = [r for r in content["rules"] if not r["reason_starts_with"].startswith("Customer says they")]
    await _publish(mongo, "status_rules", "escalations", content)
    assert escalation.manager_escalation("Customer says they're not interested any more: bought elsewhere") is None
    assert escalation.manager_escalation("Customer is clearly upset")


async def test_the_writer_prompt_as_published(mongo):
    from upsell_agent.agent import llm
    content = _default("prompts", "compose")
    content["text"] += "\nALWAYS mention free coffee."
    await _publish(mongo, "prompts", "compose", content)
    assert "free coffee" in str(llm.compose_agent("test")._instructions)


async def test_the_appointment_message_as_published(mongo):
    from datetime import UTC, datetime

    from upsell_agent.agent import appointment
    content = _default("cadences", "appointment")
    step = next(s for s in content["steps"] if s["id"] == appointment.STEP_CONFIRM)
    step["message"]["text"] = "Hi {first_name}! See you {date} at {time}. Reply Y to confirm or N to change it."
    await _publish(mongo, "cadences", "appointment", content)
    out = appointment.render_message(appointment.STEP_CONFIRM, customer_name="Maria Lopez", dealership="Victory",
                                     agent_name="Nicole", appt=datetime(2026, 10, 16, 18, 0, tzinfo=UTC))
    assert out["sms_text"].startswith("Hi Maria! See you ") and "Reply Y to confirm" in out["sms_text"]
    other = appointment.render_message(appointment.STEP_COUNTDOWN, customer_name="Maria", dealership="Victory",
                                       agent_name=None, appt=None)
    assert other["sms_text"] == "Counting down to our meeting at Victory!"  # a step not edited


# --- Safety --------------------------------------------------------------------------------------------------------

async def test_the_built_in_version_published_changes_nothing(mongo):
    for kind, key in list(ai_studio._built_in())[:40]:
        await _publish(mongo, kind, key, _default(kind, key), note="Built-in setting (what the AI does today)")
    assert not ai_studio._changed


async def test_a_broken_item_is_skipped_and_the_rest_still_apply(mongo):
    await _publish(mongo, "sources", "inbound_sources", {"pattern": "([unclosed"})
    content = _default("workflows", "cannot_supply_apr")
    await _publish(mongo, "workflows", "cannot_supply_apr", _tree_text(content, "Edited APR answer. {times}"))
    assert origin.INBOUND_SOURCES.search("website")  # the built-in list stayed
    assert cannot_supply._REPLIES["apr"].startswith("Edited APR answer.")
