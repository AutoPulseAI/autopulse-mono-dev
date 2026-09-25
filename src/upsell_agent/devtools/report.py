"""The numbers to watch, as a plain-text report (MASTER_PLAN_1 Stage 12).

    make ai-report                      # every dev dealer, last 7 days
    make ai-report DEALER=<id> DAYS=1
"""

import argparse
import asyncio
import sys

from upsell_agent.config import get_settings
from upsell_agent.devtools.simulate import DEV_DEALERS
from upsell_agent.integrations.mongodb import close_mongo, init_mongo
from upsell_agent.observability.metrics import dealer_metrics, format_report


async def _report(dealers: list[str], days: float) -> int:
    await init_mongo(get_settings())
    try:
        for dealer_id in dealers:
            print(format_report(await dealer_metrics(dealer_id, days)))
            print()
    finally:
        await close_mongo()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="AI metrics report per dealer")
    parser.add_argument("--dealer", action="append", help="dealer id (repeatable); default: the dev dealers")
    parser.add_argument("--days", type=float, default=7)
    args = parser.parse_args()
    sys.exit(asyncio.run(_report(args.dealer or [d["_id"] for d in DEV_DEALERS], args.days)))
