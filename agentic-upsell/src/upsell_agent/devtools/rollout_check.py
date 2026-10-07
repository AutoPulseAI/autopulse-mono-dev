"""Go-live checks per dealer (MASTER_PLAN_1 Stage 13): no double messages, no
lost replies, numbers within the agreed limits. Exit code 1 when a check fails.

    make ai-rollout-check                  # every dev dealer, last 7 days
    make ai-rollout-check DEALER=<id> DAYS=1
"""

import argparse
import asyncio
import sys

from upsell_agent.config import get_settings
from upsell_agent.devtools.simulate import DEV_DEALERS
from upsell_agent.integrations.mongodb import close_mongo, init_mongo
from upsell_agent.observability.rollout import format_check, rollout_check


async def _check(dealers: list[str], days: float) -> int:
    await init_mongo(get_settings())
    failed = 0
    try:
        for dealer_id in dealers:
            result = await rollout_check(dealer_id, days)
            failed += 0 if result["passed"] else 1
            print(format_check(result))
            print()
    finally:
        await close_mongo()
    return 1 if failed else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Go-live checks per dealer")
    parser.add_argument("--dealer", action="append", help="dealer id (repeatable); default: the dev dealers")
    parser.add_argument("--days", type=float, default=7)
    args = parser.parse_args()
    sys.exit(asyncio.run(_check(args.dealer or [d["_id"] for d in DEV_DEALERS], args.days)))
