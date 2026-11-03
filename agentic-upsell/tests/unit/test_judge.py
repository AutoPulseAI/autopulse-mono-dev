"""The judge (agent/judge.py; the user, 3 Nov 2026: "add a judge - agents verify their own decisions"). The tests run
the whole turn on the offline model; only the judge's model call is replaced by a fixed verdict."""

from datetime import datetime as _dt
from zoneinfo import ZoneInfo

import pytest
from bson import ObjectId

from tests.unit.conftest import make_settings, set_clock
from tests.unit.test_booking_flow import _last_sms, _lead, _offer
from upsell_agent import clock
from upsell_agent.agent import judge as judge_
from upsell_agent.agent.llm import ModelCall
from upsell_agent.agent.turn import TurnDeps
from upsell_agent.channels.fake import FakeChannelDriver
from upsell_agent.channels.sender import Sender
from upsell_agent.devtools import simulate
from upsell_agent.events.handlers import handle_inbound_message
from upsell_agent.events.models import InboundMessageEvent
from upsell_agent.integrations.platform_client import StubPlatformClient
from upsell_agent.observability.trace import MemoryTraceSink

pytestmark = pytest.mark.usefixtures("during_opening_hours", "ny_customer")
DEALER = simulate.DEV_DEALERS[0]["_id"]
MISSED = judge_.Verdict(ignores_signal=True, pushes_refused=False, contradicts=False, ok=False,
                        problem="He said he's off on Friday and the reply says we'll check back.",
                        fix="Offer Friday's open times and ask which works.")
FINE = judge_.Verdict(ignores_signal=False, pushes_refused=False, contradicts=False, ok=True)


@pytest.fixture
def verdicts(monkeypatch):
    """The judge's model answers with the verdicts given, in order; the payloads it was sent are kept."""
    seen: list[dict] = []
    queue: list[judge_.Verdict] = []

    async def fake_run_agent(agent, model, payload, **_):
        seen.append(payload)
        return queue.pop(0), ModelCall(model="openai:test", ms=1, input_tokens=1, output_tokens=1, cost_usd=None)

    monkeypatch.setattr(judge_, "OFFLINE", "no-offline-model")  # the judge runs although the writer is offline
    monkeypatch.setattr(judge_, "run_agent", fake_run_agent)
    return queue, seen


async def _say(created, text, sink):
    deps = TurnDeps(settings=make_settings("DEV"), sink=sink,
                    sender=Sender(FakeChannelDriver(), StubPlatformClient(), retry_base_s=0))
    event = InboundMessageEvent(event_id=f"m-{ObjectId()}", dealer_id=DEALER, customer_id=created["customer_id"],
                                lead_id=created["lead_id"], message_id=f"m-{ObjectId()}", channel="sms", text=text,
                                received_at=clock.now())
    await handle_inbound_message(event, deps)


def _retries(sink):
    return [e for e in sink.events if e.get("type") == "node_retry"]


async def test_a_reply_the_judge_fails_is_rewritten_once_with_its_fix(mongo, verdicts):
    queue, seen = verdicts
    queue += [FINE, MISSED]  # the offer's reply is judged too, and passes
    set_clock(_dt(2026, 11, 3, 10, 45, tzinfo=ZoneInfo("America/New_York")))
    created = await _lead()
    await _offer(mongo, created)
    sink = MemoryTraceSink()
    await _say(created, "Sorry i'm working now but I'm off on Friday", sink)
    # Judged once (the first draft); the rewrite went back to the writer with the judge's fix and isn't judged again.
    assert len(seen) == 2 and not queue
    reasons = " ".join(str(e) for e in _retries(sink))
    assert "the judge: He said he's off on Friday" in reasons and "Offer Friday's open times" in reasons
    assert await _last_sms(mongo, created)
    # It sees what the writer saw: today at the dealership, the conversation, the new message.
    payload = seen[-1]
    assert payload["now"]["weekday"] == "Tuesday" and payload["new_message"].startswith("Sorry i'm working")
    assert payload["conversation"] and payload["reply"]


async def test_a_judge_that_fails_never_holds_the_reply(mongo, monkeypatch):
    async def broken(*_, **__):
        raise TimeoutError("judge timed out")

    monkeypatch.setattr(judge_, "OFFLINE", "no-offline-model")
    monkeypatch.setattr(judge_, "run_agent", broken)
    created = await _lead()
    state = await _offer(mongo, created)
    assert state["conversation"]["visit"]["offered_times"]  # the offer went out as written
    assert "Which one works?" in await _last_sms(mongo, created)


async def test_the_switch_turns_it_off(mongo, verdicts, monkeypatch):
    queue, seen = verdicts
    monkeypatch.setattr(judge_, "ON", False)
    created = await _lead()
    await _offer(mongo, created)
    assert seen == []


def test_ok_needs_no_named_problem():
    # "not ok" with nothing wrong named is a model slip, not a verdict - checked in judge() itself.
    slip = judge_.Verdict(ignores_signal=False, pushes_refused=False, contradicts=False, ok=False, problem="meh")
    found = slip.model_dump()
    assert not (found["ignores_signal"] or found["unanswered"] or found["pushes_refused"] or found["contradicts"])


async def test_a_failed_rewrite_sends_the_first_draft_not_the_template(mongo, verdicts, monkeypatch):
    """The judge sent the draft back and the rewrite failed another check: the first draft - which passed every check
    but the judge's - is sent, never the safe template in its place."""
    from upsell_agent.agent.nodes import guard as guard_node
    queue, _ = verdicts
    queue += [FINE, MISSED]
    real = guard_node.unknown_phone_numbers

    async def phone_on_rewrite(state, ctx):
        return ["(555) 010-9999"] if state.retry_count else await real(state, ctx)

    monkeypatch.setattr(guard_node, "unknown_phone_numbers", phone_on_rewrite)
    created = await _lead()
    await _offer(mongo, created)
    sink = MemoryTraceSink()
    await _say(created, "Sorry i'm working now but I'm off on Friday", sink)
    finished = [e for e in sink.events if e.get("type") == "turn_finished"][-1]
    summary = (finished.get("data") or {}).get("summary") or {}
    assert not summary.get("used_template") and not summary.get("fallback_reason"), summary
    assert summary.get("send_status") == "sent", summary
