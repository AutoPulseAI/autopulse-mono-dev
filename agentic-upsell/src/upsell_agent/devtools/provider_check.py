"""Real test messages through the live drivers (MASTER_PLAN_1 Stage 12 step 2).

Sends ONE real SMS and/or ONE real email, from a dealer's own number and
mailbox, through exactly the drivers the worker uses (Twilio, SendGrid). Then
reply to them from the test phone / inbox and check the reply shows up in the
dealer's conversation screen: that proves the round trip (reply-to and
inbound routes) end to end.

    make ai-provider-check DEALER=<dealer id> SMS=+15551234567 EMAIL=you@team.test

Needs TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN and/or SENDGRID_API_KEY. Outside
production the recipient must also be on SEND_ALLOWLIST, like every live send.
"""

import argparse
import asyncio
import sys
import uuid

from upsell_agent.channels import get_channel_driver
from upsell_agent.channels.base import ChannelSendError, OutboundMessage
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import close_mongo, init_mongo


async def _check(dealer_id: str, sms: str | None, email: str | None) -> int:
    settings = get_settings().model_copy(update={"channel_driver": "live"})
    try:
        driver = get_channel_driver(settings)
    except ValueError as exc:
        print(f"Live drivers not configured: {exc}")
        return 2
    await init_mongo(settings)
    tag = uuid.uuid4().hex[:6]
    failed = 0
    try:
        for channel, to in (("sms", sms), ("email", email)):
            if not to:
                continue
            message = OutboundMessage(
                dealer_id=dealer_id, lead_id=f"provider-check-{tag}", customer_id="provider-check", channel=channel,
                to=to, subject=f"AutoPulse AI test {tag}" if channel == "email" else None,
                text=f"AutoPulse AI test message {tag}. Reply to this to check replies reach the dealer's inbox.",
                idempotency_key=f"provider-check-{tag}:{channel}",
            )
            try:
                result = await driver.send(message)
            except ChannelSendError as exc:
                failed += 1
                print(f"FAIL  {channel} to {to}: {exc}")
                continue
            print(f"SENT  {channel} to {to}: provider id {result.provider_id} ({result.status})")
    finally:
        await close_mongo()
    if not failed:
        print(f"\nNow reply to test {tag} from the phone / inbox, and check the reply appears in the "
              "dealer's conversation screen.")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dealer", required=True, help="dealer id (platform User _id)")
    parser.add_argument("--sms", help="test phone number, E.164")
    parser.add_argument("--email", help="test email address")
    args = parser.parse_args()
    if not (args.sms or args.email):
        parser.error("give --sms and/or --email")
    return asyncio.run(_check(args.dealer, args.sms, args.email))


if __name__ == "__main__":
    sys.exit(main())
