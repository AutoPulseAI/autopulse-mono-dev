"""Reopens the leads the Day 91 sweep closed although the customer had written within the 91 days before (19 Nov 2026,
Nomayer Hossen: wrote 15 Nov, closed 19 Nov). Under the rule now (lifecycle.REPLY_RESTARTS_DAY_91) they would still
be open. Each goes through the lifecycle as the customer's reply it was: Contact Made - No Next Action, a fresh 91
days, its follow-ups started again, and the CRM status follows (Contacted - No Next Action). A lead staff changed
since (its CRM status is no longer the AI's Closed - Lost) is left alone. Without --apply it only lists them.

    PYTHONPATH=src python -m upsell_agent.devtools.reopen_day91_replied [--dealer <id>] [--apply]
"""

import argparse
import asyncio
from datetime import timedelta

from bson import ObjectId

from upsell_agent.agent import lifecycle
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    close_mongo,
    dealer_scoped_db,
    get_db,
    init_mongo,
)

CRM_CLOSED_LOST = {"Closed - Lost", "Closed Lost"}


def _oid(value):
    return ObjectId(str(value)) if ObjectId.is_valid(str(value)) else value


async def _run(dealer: str | None, apply: bool) -> int:
    await init_mongo(get_settings())
    try:
        query = {"stage": lifecycle.Stage.CLOSED_LOST.value, "closed_reason": "day_91_no_response",
                 "last_inbound_at": {"$ne": None}, **({"dealer_id": dealer} if dealer else {})}
        rows = await get_db()[AI_LEAD_STATE_COLLECTION].find(query).to_list(None)
        found = reopened = skipped = 0
        for row in rows:
            closed_at, replied = lifecycle._aware(row.get("closed_at")), lifecycle._aware(row.get("last_inbound_at"))
            if not closed_at or not replied or replied <= closed_at - timedelta(days=lifecycle.OPPORTUNITY_DAYS):
                continue  # no reply within the 91 days before the closing: the closing stands
            found += 1
            db = dealer_scoped_db(row["dealer_id"])
            lead = await db.collection(PLATFORM_LEADS_COLLECTION).find_one({"_id": _oid(row["lead_id"])})
            status = (lead or {}).get("fe_lead_status") or (lead or {}).get("lead_status") or (lead or {}).get("status")
            line = (f"{(lead or {}).get('name') or row['lead_id']} | lead {row['lead_id']} | replied "
                    f"{replied:%Y-%m-%d} | closed {closed_at:%Y-%m-%d} | CRM status now {status}")
            if status not in CRM_CLOSED_LOST:
                skipped += 1
                print(f"KEEP (staff changed it)  {line}")
                continue
            if not apply:
                print(f"WOULD REOPEN  {line}")
                continue
            moved = await lifecycle.apply(db, row["lead_id"], [lifecycle.Event(
                "customer_replied", source="day91_reply_fix",
                reason="Reopened: the customer had written within the 91 days before the Day 91 closing")], lead=lead)
            if moved and moved.get("changed"):
                reopened += 1
                print(f"REOPENED  {line} -> {moved.get('label')}")
            else:
                print(f"NOT MOVED  {line} ({moved})")
        print(f"{'APPLY' if apply else 'DRY RUN'}: {found} closed lead(s) had a reply within their 91 days; "
              f"{reopened if apply else found - skipped} {'reopened' if apply else 'would be reopened'}; "
              f"{skipped} kept (staff changed the status).")
    finally:
        await close_mongo()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reopen Day 91 closings of leads that had replied")
    parser.add_argument("--dealer", help="one dealer id; default: every dealer")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(_run(args.dealer, args.apply)))
