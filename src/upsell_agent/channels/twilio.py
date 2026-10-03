"""Live SMS through Twilio's Messages API (MASTER_PLAN_1 Stage 12).

Plain HTTPS with httpx (no SDK): one POST per message, from the dealer's own
Twilio number, with our delivery webhook as the status callback when
PUBLIC_BASE_URL is set. A vehicle photo (MASTER_PLAN_4 F3) rides along as
`MediaUrl`, which makes it an MMS.

How a failure is classified (the sender retries only retryable ones):
- network error, timeout, 429, 5xx: retryable
- 21610 "unsubscribed recipient": the customer texted STOP to this number;
  suppressed, and our consent record is turned off
- any other 4xx (invalid number, bad credentials, ...): permanent
"""

import logging

import httpx

from upsell_agent.channels.base import ChannelSendError, OutboundMessage, SendResult
from upsell_agent.channels.dealer_identity import dealer_identity

logger = logging.getLogger(__name__)

TIMEOUT_S = 10.0
UNSUBSCRIBED_RECIPIENT = 21610


class TwilioSmsDriver:
    name = "twilio"

    def __init__(self, *, account_sid: str, auth_token: str, api_base: str = "https://api.twilio.com",
                 status_callback: str | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not account_sid or not auth_token:
            raise ValueError("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for live SMS")
        self._url = f"{api_base.rstrip('/')}/2010-04-01/Accounts/{account_sid}/Messages.json"
        self._auth = (account_sid, auth_token)
        self._status_callback = status_callback
        self._transport = transport

    async def send(self, message: OutboundMessage) -> SendResult:
        identity = await dealer_identity(message.dealer_id)
        if not identity.sms_from:
            raise ChannelSendError("dealer has no Twilio number (sms_conversion_phone)", retryable=False)
        form: dict[str, str | list[str]] = {"To": message.to, "From": identity.sms_from, "Body": message.text}
        if message.media_urls:
            # MASTER_PLAN_4 F3: the vehicle's photo as MMS. Twilio takes one MediaUrl per image.
            form["MediaUrl"] = list(message.media_urls)
        if self._status_callback:
            form["StatusCallback"] = self._status_callback
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.post(self._url, data=form, auth=self._auth)
        except httpx.HTTPError as exc:
            raise ChannelSendError(f"Twilio unreachable: {exc!r}", retryable=True) from exc

        if response.status_code in (200, 201):
            body = response.json()
            return SendResult(provider_id=body["sid"], status=body.get("status", "queued"))
        try:
            error = response.json()
        except ValueError:
            error = {}
        code = error.get("code")
        detail = f"Twilio {response.status_code}" + (f" error {code}" if code else "") + (
            f": {error.get('message')}" if error.get("message") else "")
        if code == UNSUBSCRIBED_RECIPIENT:
            raise ChannelSendError(detail, suppress=True, opted_out=True)
        if response.status_code == 429 or response.status_code >= 500:
            raise ChannelSendError(detail, retryable=True)
        if response.status_code in (401, 403):
            logger.error("Twilio rejected our credentials: %s", detail)
        raise ChannelSendError(detail, retryable=False)
