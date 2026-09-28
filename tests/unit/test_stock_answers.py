"""MASTER_PLAN_3 Phase 3 (answering stock questions) and Phase 4 (grounding),
built together (decision A): `inventory` reaches the models only in the same
change that adds the check catching a wrong vehicle fact.

- a stock question is answered from real, loaded stock, or an honest
  alternative/promise - never a bare "no" (decision D);
- every vehicle mentioned is grounded: a real VIN from this turn's inventory,
  described only with that record's own fields (Phase 4);
- vehicles already shown aren't offered again as new (decision F);
- the 24h channel switch never resends a vehicle mention (decision L).

Links, MMS images (decision H) and resolving "the second one" to a VIN
(decision G) are deferred to a follow-up change; not covered here.
"""

from datetime import UTC, datetime

from bson import ObjectId

from tests.unit.conftest import make_settings
from tests.unit.test_inventory_tool import DEALER, _stock, _vehicle
from upsell_agent.agent.conversation import ConversationState, after_turn
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent
from upsell_agent.guardrails.draft_guard import check_draft
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    DEV_OUTBOX_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink
from upsell_agent.tools.inventory_tool import clear_cache

RAV4 = {"vin": "VIN00000000000701", "make": "Toyota", "model": "RAV4", "trim": "LE", "year": 2022, "miles": 18000,
       "exterior_color": "White", "condition": "used", "already_shown": False}


def _rav4(vin, **kw):
    return _vehicle(vin, make="Toyota", model="RAV4", **kw)


def _guard(draft, *, texts=(), known=(), inventory=()):
    return check_draft(draft, customer_texts=list(texts), known_values=list(known), inventory=list(inventory))


DRAFT = {"sms_text": "placeholder", "email_subject": "Your inquiry", "email_body": "placeholder body"}


def _draft(sms=None, email=None, **extra):
    return {**DRAFT, **({"sms_text": sms} if sms else {}), **({"email_body": email} if email else {}), **extra}


# --- Grounding, direct unit tests on the guard (Phase 4) --------------------------------------------------

def test_naming_a_real_vehicle_passes():
    result = _guard(_draft("Good news - we have a 2022 White Toyota RAV4 LE (18,000 miles) in stock.",
                           sms_vins=[RAV4["vin"]], email_vins=[RAV4["vin"]]),
                    inventory=[RAV4])
    assert result["passed"], result["violations"]


def test_a_vin_not_in_this_turns_stock_is_rejected():
    result = _guard(_draft("We have it in stock.", sms_vins=["MADE-UP-VIN"]), inventory=[RAV4])
    assert not result["passed"]
    assert any("not in this turn's stock" in v for v in result["violations"])


def test_more_vehicles_than_the_channel_allows_is_rejected():
    others = [{**RAV4, "vin": f"VIN0000000000070{i}"} for i in (2, 3)]
    result = _guard(_draft("We have three in stock.", sms_vins=[RAV4["vin"], *[o["vin"] for o in others]]),
                    inventory=[RAV4, *others])
    assert not result["passed"]
    assert any("at most 2" in v for v in result["violations"])


def test_an_invented_trim_is_rejected():
    result = _guard(_draft("We have a Toyota RAV4 in the XLE trim.", sms_vins=[RAV4["vin"]], email_vins=[RAV4["vin"]]),
                    inventory=[RAV4])
    assert not result["passed"]
    assert any("trim not on the named vehicle" in v for v in result["violations"])


def test_an_invented_make_is_rejected():
    result = _guard(_draft("We have a Honda RAV4 in stock.", sms_vins=[RAV4["vin"]], email_vins=[RAV4["vin"]]),
                    inventory=[RAV4])
    assert not result["passed"]
    assert any("make not on the named vehicle" in v for v in result["violations"])


def test_a_bare_denial_is_rejected():
    result = _guard(_draft("Sorry, we don't have that in stock."))
    assert not result["passed"]
    assert any("no alternative offered and no promise made" in v for v in result["violations"])


def test_a_denial_with_a_promise_is_allowed():
    result = _guard(_draft("Sorry, we don't have that in stock.", promises=["The team will let you know."]))
    assert result["passed"], result["violations"]


def test_availability_with_no_named_vehicle_is_rejected():
    result = _guard(_draft("Yes, it's still available!"))
    assert not result["passed"]
    assert any("without naming a real one" in v for v in result["violations"])


def test_a_makes_own_car_mention_isnt_flagged_as_grounding():
    """The customer's own trade-in, echoed back in plain words, names no
    vehicle from inventory and isn't a stock claim - not a grounding problem."""
    result = _guard(_draft("Got it - a 2019 Ford F-150 as your trade-in."), known=[2019])
    assert result["checks"]["grounded_in_real_stock"]


def test_an_about_me_denial_isnt_caught_by_the_unavailable_check():
    result = _guard(_draft("I don't have any details from you yet."))
    assert result["checks"]["grounded_in_real_stock"]


# --- Through real turns (Phase 3) -------------------------------------------------------------------------

def _deps() -> TurnDeps:
    return TurnDeps(settings=make_settings("DEV"), sink=MemoryTraceSink(), store_prompts=True,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))


async def _lead():
    created = await simulate.create_lead(DEALER, lead_type="sales", channel="sms", name="Stan Stockwell",
                                         comments="Hi, I saw your ad")
    await handlers.handle_lead_created(LeadCreatedEvent(
        event_id=created["lead_id"], dealer_id=DEALER, lead_id=created["lead_id"],
        customer_id=created["customer_id"], channel="sms"), _deps())
    return created


async def _say(created, text):
    message_id = str(ObjectId())
    return await handlers.handle_inbound_message(InboundMessageEvent(
        event_id=message_id, dealer_id=DEALER, customer_id=created["customer_id"], lead_id=created["lead_id"],
        channel="sms", message_id=message_id, text=text, received_at=datetime.now(UTC)), _deps())


async def _last(mongo, created):
    turn = (await mongo[AI_TURN_LOG_COLLECTION].find({"lead_id": created["lead_id"]})
            .sort("created_at", -1).to_list(1))[0]
    sms = (await mongo[DEV_OUTBOX_COLLECTION].find({"lead_id": created["lead_id"]})
           .sort("created_at", -1).to_list(1))[0]["text"]
    return turn, sms


def _compose_nodes(turn):
    return [n for n in turn["nodes"] if n["node"] == "compose" and n.get("status") == "done"]


async def test_answers_a_stock_question_from_real_stock(mongo):
    await _stock(mongo, _rav4("VIN00000000000711", color="White", trim="LE"))
    created = await _lead()
    await _say(created, "Do you have a Toyota RAV4?")
    turn, sms = await _last(mongo, created)
    assert "RAV4" in sms
    compose = _compose_nodes(turn)[-1]
    assert compose["output"]["sms_vins"] == ["VIN00000000000711"]
    assert compose["attempt"] == 1  # the guard passed first time, real stock is grounded by construction


async def test_texting_wording_still_answers_from_stock(mongo):
    """Found live (29 Sept): "what RAV4 models do u have in inventory?" fell
    through the old stock-question regex (needed "do you have", not "do u
    have"; "in inventory" wasn't recognised at all) and got the generic
    "our team will confirm" fallback instead of a real answer."""
    await _stock(mongo, _rav4("VIN00000000000751", color="White", trim="LE"))
    created = await _lead()
    await _say(created, "what RAV4 models do u have in inventory?")
    _, sms = await _last(mongo, created)
    assert "RAV4" in sms
    assert "our team will confirm" not in sms.lower()


async def test_no_match_offers_a_promise_never_a_bare_no(mongo):
    created = await _lead()  # no stock at all
    await _say(created, "Do you have a Ford Mustang?")
    turn, sms = await _last(mongo, created)
    assert "team" in sms.lower() and "let you know" in sms.lower()
    guard = next(n for n in turn["nodes"] if n["node"] == "guard" and n.get("status") == "done")
    assert guard["output"]["passed"]  # never rejected as a bare denial with no alternative/promise
    state = await mongo[AI_LEAD_STATE_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert any("let you know" in p["text"] for p in state["conversation"]["promises"])


async def test_a_vehicle_already_shown_isnt_offered_again_as_new(mongo):
    """chosen = fresh (unshown) records first, so a second vehicle added to
    stock after the first turn is what gets named, not a repeat of the first."""
    await _stock(mongo, _rav4("VIN00000000000721"))
    created = await _lead()
    await _say(created, "Do you have a Toyota RAV4?")
    first_vins = _compose_nodes((await _last(mongo, created))[0])[-1]["output"]["sms_vins"]
    assert first_vins == ["VIN00000000000721"]

    await _stock(mongo, _rav4("VIN00000000000722"))
    clear_cache()  # the first search's 60s cache would otherwise still show only VIN721
    await _say(created, "Do you have a Toyota RAV4?")
    second_vins = _compose_nodes((await _last(mongo, created))[0])[-1]["output"]["sms_vins"]
    assert second_vins == ["VIN00000000000722"]  # not the one already shown


async def test_an_invented_trim_is_rewritten_then_sent_clean(mongo):
    """#badtrim (dev hint, offline model only): the first draft injects a trim
    not on the named vehicle; the guard rejects it and the rewrite passes -
    MASTER_PLAN_3 Phase 4's "done when: zero grounding rejections left after
    the rewrite"."""
    await _stock(mongo, _rav4("VIN00000000000731", trim="LE"))
    created = await _lead()
    await _say(created, "#badtrim Do you have a Toyota RAV4?")
    turn, sms = await _last(mongo, created)
    composes = _compose_nodes(turn)
    assert len(composes) == 2 and composes[0]["attempt"] == 1 and composes[1]["attempt"] == 2
    assert "Limited" not in sms and "Sport" not in sms
    guard_nodes = [n for n in turn["nodes"] if n["node"] == "guard" and n.get("status") == "done"]
    assert any("trim" in v for g in guard_nodes for v in g["output"]["violations"])


async def test_channel_switch_never_resends_a_named_vehicle(mongo):
    """Decision L: the 24h follow-up (created right after the send) stores the
    stock-free version of the message, not the one that named a vehicle."""
    await _stock(mongo, _rav4("VIN00000000000741"))
    created = await _lead()
    await _say(created, "Do you have a Toyota RAV4?")
    _, sms = await _last(mongo, created)
    assert "RAV4" in sms  # the sent message does name it
    followup = await mongo[SCHEDULED_FOLLOWUPS_COLLECTION].find_one({"lead_id": created["lead_id"]})
    assert followup is not None
    assert "RAV4" not in (followup.get("text") or "")


# --- shown_vehicles (decision F): per-lead, capped -----------------------------------------------------

def test_shown_vehicles_are_recorded_and_capped():
    state = ConversationState()
    for i in range(15):
        state = after_turn(state, now=datetime.now(UTC), send_status="sent", shadow=False, action="answer",
                           asked_slots=[], answered=[], new_questions=[], used_template=False, promises=[],
                           shown_vins=[f"VIN{i:04d}"], channel="sms")
    assert len(state.shown_vehicles) == 10
    assert state.shown_vehicles[-1].vin == "VIN0014" and state.shown_vehicles[0].vin == "VIN0005"


def test_shown_vehicles_dont_repeat_and_are_isolated_per_lead():
    a = after_turn(ConversationState(), now=datetime.now(UTC), send_status="sent", shadow=False, action="answer",
                   asked_slots=[], answered=[], new_questions=[], used_template=False, promises=[],
                   shown_vins=["VIN0001", "VIN0001"], channel="sms")
    assert [v.vin for v in a.shown_vehicles] == ["VIN0001"]  # no duplicate within one turn

    b = ConversationState()  # a second lead's state, never touched by `a`'s turn
    assert b.shown_vehicles == []
