"""PLAN_4 stream V: the scenarios reconciled with the audit fix streams (X1, X3)."""

from upsell_agent import clock
from upsell_agent.devtools.scenarios import _kind_filter, sent_by_ai_filter
from upsell_agent.integrations.mongodb import AI_MESSAGES_COLLECTION, dealer_scoped_db

DEALER = "66f0000000000000000000c3"


async def test_a_shadow_leads_copied_crm_history_is_not_counted_as_sent_by_the_ai(mongo):
    """s13_shadow_dealer against crm-local counted 1 text "sent": n8n's own reply, which the history sync (X3
    item 5) copies into the AI's thread as `sent` + `imported`. The AI's own rows were both `shadow`."""
    rows = dealer_scoped_db(DEALER).collection(AI_MESSAGES_COLLECTION)
    base = {"lead_id": "L1", "channel": "sms", "direction": "outbound", "created_at": clock.now()}
    await rows.insert_one({**base, "status": "shadow", "text": "the AI's draft"})
    await rows.insert_one({**base, "status": "sent", "text": "Hi Shay! (n8n)", "author": "crm", "imported": True})
    assert await rows.find(sent_by_ai_filter("L1", "sms")).to_list(None) == []

    await rows.insert_one({**base, "status": "sent", "text": "the AI's own text"})
    left = await rows.find(sent_by_ai_filter("L1", "sms")).to_list(None)
    assert [r["text"] for r in left] == ["the AI's own text"]


def test_the_held_first_reply_is_a_follow_up_kind_a_scenario_can_check():
    assert _kind_filter({"kind": "first_reply_held"}) == {"kind": "first_reply_held"}
