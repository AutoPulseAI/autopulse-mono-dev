"""CHANNEL_DRIVER=live: SMS through Twilio, email through SendGrid
(architecture §9), with the test allowlist outside production.

Outside production (ENVIRONMENT is anything but PROD), a recipient that is not
on SEND_ALLOWLIST is suppressed before any provider is called, so a staging
run with real credentials can only ever reach the team's test phones and
inboxes (MASTER_PLAN_1 Stage 12).
"""

from upsell_agent.channels.base import ChannelDriver, ChannelSendError, OutboundMessage, SendResult


def _normalize(recipient: str) -> str:
    return recipient.strip().lower()


class LiveChannelDriver:
    name = "live"

    def __init__(self, *, sms: ChannelDriver, email: ChannelDriver, allowlist: set[str] | None = None) -> None:
        """`allowlist=None` means production: anyone may be messaged."""
        self._drivers = {"sms": sms, "email": email}
        self._allowlist = None if allowlist is None else {_normalize(a) for a in allowlist}

    async def send(self, message: OutboundMessage) -> SendResult:
        if self._allowlist is not None and _normalize(message.to) not in self._allowlist:
            raise ChannelSendError(f"{message.to} is not on SEND_ALLOWLIST (non-production)", suppress=True)
        return await self._drivers[message.channel].send(message)
