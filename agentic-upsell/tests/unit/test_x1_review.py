"""PLAN_4 stream X1 item 3: an open REVIEW (a possible opt-out, decision 72) stops every automated send except a
reply to the customer's own message, and is not cleared merely because the customer wrote again."""

import pytest

from tests.unit.conftest import set_clock
from tests.unit.test_compliance import DEALER, _check, _deps, _inbound, _lead, ny
from upsell_agent.channels import consent
from upsell_agent.compliance.opt_out import answers_review
from upsell_agent.devtools import simulate
from upsell_agent.events import handlers
from upsell_agent.integrations.mongodb import dealer_scoped_db


@pytest.fixture
async def dealers(mongo):
    await simulate.ensure_platform_dealers()


async def _with_review(mongo):
    set_clock(ny(22, 12))
    created = await _lead(mongo, source="website")
    await consent.record_consent(dealer_scoped_db(DEALER), customer_id=created["customer_id"], channel="all",
                                 consent_type="review", status="open", source="possible_opt_out",
                                 lead_id=created["lead_id"], evidence={"message": "why do you keep texting me"})
    return created


@pytest.mark.parametrize(("purpose", "is_reply", "outcome"), [
    ("marketing", False, "REVIEW"),
    ("transactional", False, "REVIEW"),   # the countdown with its photo, the no-show follow-up
    ("lead_response", False, "REVIEW"),
    ("reply", True, "ALLOW"),
])
async def test_an_open_review_stops_every_automated_send_but_a_reply(mongo, dealers, purpose, is_reply, outcome):
    created = await _with_review(mongo)
    assert (await _check(created, purpose=purpose, is_reply=is_reply)).outcome == outcome


@pytest.mark.parametrize("text", ["ok", "??", "why", "whatever", "you guys text too much", "nope"])
async def test_writing_again_does_not_clear_the_review_by_itself(mongo, dealers, text):
    created = await _with_review(mongo)
    await handlers.handle_inbound_message(_inbound(created, text), _deps())
    assert await consent.open_review(dealer_scoped_db(DEALER), created["customer_id"])


async def test_a_clear_answer_resolves_it(mongo, dealers):
    created = await _with_review(mongo)
    await handlers.handle_inbound_message(_inbound(created, "Sorry, yes I still want to see the CR-V Saturday"),
                                          _deps())
    assert not await consent.open_review(dealer_scoped_db(DEALER), created["customer_id"])
    assert (await _check(created, purpose="transactional")).outcome == "ALLOW"


@pytest.mark.parametrize(("text", "answers"), [
    ("Is the CR-V still there?", True),
    ("Yes I'm still looking for a truck", True),
    ("ok", False),
    ("stop asking", False),
    ("too many messages lately", False),
    ("not interested", False),
    ("who is this", False),
])
def test_answers_review(text, answers):
    assert answers_review(text) is answers
