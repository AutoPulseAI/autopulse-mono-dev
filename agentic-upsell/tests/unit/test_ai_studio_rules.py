"""AI Studio: every rule editable (client, 13 Oct 2026: "each and every rule ... the AI related to emails etc ... add,
update, delete"). Texting hours and limits, state rules, opt-out words, channel rules, message limits and banned
phrases, the fixed texts, and the end steps of a workflow - each published the way the CRM does, then checked in what
the AI does.
"""

from datetime import UTC, datetime, time, timedelta

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_ai_studio_live import _default, _publish
from tests.unit.test_booking_flow import _last_sms, _say
from tests.unit.test_client_requirements import RAV4, _new_lead, _sent
from upsell_agent import ai_studio
from upsell_agent.agent import templates
from upsell_agent.agent.nodes import guard
from upsell_agent.channels import consent
from upsell_agent.compliance import engine, opt_out, state_hours
from upsell_agent.guardrails import draft_guard

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")


async def test_texting_hours_and_limits(mongo):
    c = _default("compliance", "texting_hours")
    c.update(reply_window=["09:00", "19:00"], follow_up_window=["10:00", "18:00"], follow_up_texts_per_period=1,
             period_hours=48, dnd_statuses=["dnd", "do not contact", "lost - do not text"])
    await _publish(mongo, "compliance", "texting_hours", c)
    assert engine.REPLY_WINDOW == (time(9), time(19)) and engine.MARKETING_WINDOW == (time(10), time(18))
    assert engine.MARKETING_SMS_CAP == 1 and engine.CAP_PERIOD == timedelta(hours=48)
    assert "lost - do not text" in engine.DND_STATUSES
    ai_studio.reset()
    assert engine.REPLY_WINDOW == (time(8), time(21)) and "lost - do not text" not in engine.DND_STATUSES


async def test_hours_never_go_past_the_federal_window(mongo):
    c = _default("compliance", "texting_hours")
    c["reply_window"] = ["06:00", "23:00"]
    await _publish(mongo, "compliance", "texting_hours", c)
    assert engine.REPLY_WINDOW == (time(8), time(21))


async def test_state_rules_add_edit_delete(mongo):
    c = _default("compliance", "state_rules")
    rows = [r for r in c["rows"] if r["state"] != "AK"]  # deleted
    ny = next(r for r in rows if r["state"] == "NY")
    ny.update(weekday=["09:00", "20:00"], sunday=None, cap_texts=2, cap_hours=24)  # edited
    rows.append({"state": "PR", "weekday": ["10:00", "18:00"], "saturday": None, "sunday": None,
                 "holidays_banned": True, "cap_texts": None, "cap_hours": None, "no_unsolicited_sales_texts": False,
                 "note": "added in AI Studio"})  # added
    c["rows"] = rows
    await _publish(mongo, "compliance", "state_rules", c)
    assert "AK" not in state_hours.STATE_RULES
    assert state_hours.STATE_RULES["NY"].weekday == (time(9), time(20)) and state_hours.STATE_RULES["NY"].sunday is None
    assert state_hours.STATE_RULES["NY"].cap == (2, timedelta(hours=24))
    assert state_hours.STATE_RULES["PR"].holidays_banned


async def test_opt_out_words_and_phrases(mongo):
    c = _default("compliance", "opt_out")
    c["stop_words"] = [*c["stop_words"], "basta"]
    c["extra_stop_phrases"] = ["take me off your list"]
    c["confirmation"] = "Done - you won't hear from us again."
    await _publish(mongo, "compliance", "opt_out", c)
    assert opt_out.detect_opt_out("BASTA", "sms") is not None
    found = opt_out.detect_opt_out("please take me off your list", "sms")
    assert found and set(found.channels) == set(opt_out.ALL_CHANNELS)
    assert opt_out.confirmation_text(opt_out.ALL_CHANNELS) == "Done - you won't hear from us again."


async def test_email_first_channel_rule(mongo):
    c = _default("compliance", "channels")
    c["first_channel"] = "email"
    await _publish(mongo, "compliance", "channels", c)
    created = await _new_lead(mongo, vehicle=RAV4)
    assert await _sent(mongo, created, "email") and not await _sent(mongo, created)


async def test_wait_for_text_at_night(mongo):
    c = _default("compliance", "channels")
    c["at_night"] = "wait_for_text"
    await _publish(mongo, "compliance", "channels", c)
    set_clock(datetime(2026, 9, 23, 3, 10, tzinfo=UTC))  # 11:10 PM New York
    created = await _new_lead(mongo, vehicle=RAV4)
    assert not await _sent(mongo, created, "email") and not await _sent(mongo, created)


async def test_placeholder_email_list(mongo):
    c = _default("compliance", "channels")
    c["placeholder_emails"] = [*c["placeholder_emails"], "leads"]
    await _publish(mongo, "compliance", "channels", c)
    assert consent.resolve_recipient({"email": "leads@portal.example"}, {}, "email") is None
    assert consent.resolve_recipient({"email": "maria@example.com"}, {}, "email") == "maria@example.com"


async def test_message_limits_and_banned_phrases(mongo):
    c = _default("compliance", "writing")
    c.update(sms_max_characters=200, cars_per_text=1, banned_phrases=["the team", "no problem"])
    await _publish(mongo, "compliance", "writing", c)
    assert draft_guard.SMS_MAX == 200 and draft_guard.SMS_MAX_VEHICLES == 1
    assert guard._TEAM.search("No problem at all!") and not guard._TEAM.search("Our sales manager will call")


async def test_fixed_texts_are_editable(mongo):
    c = _default("messages", "holding_still_waiting")
    c["message"]["text"] = "Sorry for the wait, {first_name}! Our manager will text you within the hour."
    await _publish(mongo, "messages", "holding_still_waiting", c)
    assert templates.render_holding_reply("still_waiting", "Jean Castro")["sms_text"] == (
        "Sorry for the wait, Jean! Our manager will text you within the hour.")
    v = _default("messages", "continue_variant_2")
    v["message"]["text"] = "Thank you, {first_name}. When is a good time to stop by this week?"
    await _publish(mongo, "messages", "continue_variant_2", v)
    assert templates.CONTINUE_VARIANTS[1] == "Thank you, {name}. When is a good time to stop by this week?"


async def test_workflow_end_steps_set_a_status_and_create_a_call_task(mongo):
    from upsell_agent.integrations.mongodb import (
        AI_LEAD_STATE_COLLECTION,
        SCHEDULED_FOLLOWUPS_COLLECTION,
    )
    tree = {"id": "start", "message": {"mode": "fixed", "text": "Are you paying cash?"}, "branches": [
        {"when": {"type": "reply", "value": "yes"}, "then": {"action": "set_status",
                                                               "status": "Contacted - Specific Follow-up"}},
        {"when": {"type": "reply", "value": "no"}, "then": {"action": "call_task"}}]}
    await _publish(mongo, "workflows", "cash_buyer", {"trigger": {"phrases": ["pay cash", "cash deal"]},
                                                      "tree": tree})
    created = await _new_lead(mongo, vehicle=RAV4)
    await _say(created, "Can I do a cash deal on it?")
    assert await _last_sms(mongo, created) == "Are you paying cash?"
    await _say(created, "yes")
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert state["crm_status_sync"]["crm_status"] == "Contacted - Specific Follow-up"
    other = await _new_lead(mongo, vehicle=RAV4, name="Ann Lee")
    await _say(other, "Can I do a cash deal?")
    await _say(other, "no")
    tasks = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find({"lead_id": other["lead_id"], "kind": "call_task"}
                                                             ).to_list(None)
    assert tasks


async def test_a_rule_the_dealership_adds(mongo):
    """Client, 13 Oct 2026: "I am not seeing any add button to add new rules" - "+ New rule" in SMS, Email &
    Compliance: an instruction the AI follows in every message, and phrases it must never say."""
    from upsell_agent.agent import llm
    await _publish(mongo, "compliance", "no_discount_by_text", {
        "rule": "Never offer a discount by text.", "applies_to": ["text"], "banned_phrases": ["best price guaranteed"]})
    instructions = str(llm.compose_agent("test")._instructions)
    assert "Never offer a discount by text. (text messages only)" in instructions
    assert '"best price guaranteed"' in instructions
    assert guard._TEAM.search("Best price guaranteed on this one!") and guard._TEAM.search("our team will call")
    ai_studio.reset()
    assert "Never offer a discount" not in str(llm.compose_agent("test")._instructions)
    assert not guard._TEAM.search("Best price guaranteed")


async def test_what_counts_as_dealership_action_required_is_editable(mongo):
    """Client, 16 Oct 2026: the alerts that count are set in AI Studio too."""
    from upsell_agent.api.staff_view import list_notices, needs_action
    c = _default("status_rules", "alert_kinds")
    c["counts"] = [k for k in c["counts"] if k != "possible_opt_out"] + ["call_task"]
    await _publish(mongo, "status_rules", "alert_kinds", c)
    assert needs_action({"kind": "call_task"}) and not needs_action({"kind": "possible_opt_out"})
    await mongo["ai_lead_state"].insert_one({"lead_id": "L9", "dealer_id": "d9",
                                             "staff_notice": {"at": datetime(2026, 10, 1, tzinfo=UTC), "kind": "call_task",
                                                              "text": "Call them"}})
    assert (await list_notices("d9"))["unhandled_count"] == 1
    ai_studio.reset()
    assert not needs_action({"kind": "call_task"}) and needs_action({"kind": "possible_opt_out"})


@pytest.mark.one_question
async def test_conversation_rules_are_editable(mongo):
    """Client, 19 Oct 2026: questions per message and "switch the AI off after failed drafts" in AI Studio."""
    from upsell_agent.slots import policy
    assert policy.MAX_ASKS_PER_MESSAGE == 1 and guard.HANDOFF_AFTER_FAILED_DRAFTS is False
    c = _default("compliance", "conversation_rules")
    c.update(questions_per_message=2, switch_ai_off_after_failed_drafts=True)
    await _publish(mongo, "compliance", "conversation_rules", c)
    assert policy.MAX_ASKS_PER_MESSAGE == 2 and guard.HANDOFF_AFTER_FAILED_DRAFTS is True
    ai_studio.reset()
    assert policy.MAX_ASKS_PER_MESSAGE == 1 and guard.HANDOFF_AFTER_FAILED_DRAFTS is False
