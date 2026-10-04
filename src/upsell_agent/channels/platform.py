"""CHANNEL_DRIVER=platform: the CRM (aidmvcs-be-dev) sends for us
(MASTER_PLAN_4 stream C1).

One POST to the CRM's `/api/internal/ai/messages/send` with the shared
secret. The CRM sends through its own `sendSMS` / `sendEmail` - the dealer's
own Twilio number and mailbox, exactly like a staff message - records the AI
Email in the lead's conversation, and answers with the provider id. Delivery
updates reach the same record through the existing status route. So every
message, date and time the AI sends is in the CRM, the way the user asked.

The sender's own platform record afterwards (`record_message`) is answered
idempotently by the CRM (same idempotency key), so nothing is recorded twice.

How the CRM's answer is classified (the sender retries only retryable ones):
- 200: sent, `provider_id` returned
- 422 with `opted_out`: the customer texted STOP; suppressed, consent turned off
- other 4xx (`retryable: false`): permanent (no dealer number, bad address, ...)
- network error, timeout, 5xx, 429: retryable

The CRM stubs the actual provider call in local/dev runs
(PROVIDER_SEND_STUB=true, aidmvcs-be-dev app/lib/providerStub.js). Outside
production, a non-empty SEND_ALLOWLIST is also enforced here, before the CRM
is asked, like the live driver does.
"""

import logging

import httpx

from upsell_agent.channels.base import ChannelSendError, OutboundMessage, SendResult

logger = logging.getLogger(__name__)

TIMEOUT_S = 15.0
SEND_PATH = "/api/internal/ai/messages/send"


class PlatformChannelDriver:
    name = "platform"

    def __init__(self, *, base_url: str, shared_secret: str, allowlist: set[str] | None = None,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not base_url or not shared_secret:
            raise ValueError("AUTOPULSE_API_BASE_URL and UPSELL_SERVICE_SHARED_SECRET are required for "
                             "CHANNEL_DRIVER=platform")
        self._url = f"{base_url.rstrip('/')}{SEND_PATH}"
        self._headers = {"Authorization": f"Bearer {shared_secret}"}
        self._allowlist = None if not allowlist else {a.strip().lower() for a in allowlist}
        self._transport = transport

    async def send(self, message: OutboundMessage) -> SendResult:
        if self._allowlist is not None and message.to.strip().lower() not in self._allowlist:
            raise ChannelSendError(f"{message.to} is not on SEND_ALLOWLIST (non-production)", suppress=True)
        payload = {
            "dealer_id": message.dealer_id, "lead_id": message.lead_id, "customer_id": message.customer_id,
            "channel": message.channel, "to": message.to, "text": message.text, "subject": message.subject,
            "idempotency_key": message.idempotency_key, "media_urls": list(message.media_urls or ()),
            # PLAN_4 stream X1 item 5: the CRM checks this decision (ALLOW, this lead / channel / recipient).
            "compliance_decision_id": message.compliance_decision_id,
        }
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.post(self._url, json=payload, headers=self._headers)
        except httpx.HTTPError as exc:
            raise ChannelSendError(f"CRM unreachable: {exc!r}", retryable=True) from exc

        try:
            body = response.json()
        except ValueError:
            body = {}
        if response.status_code == 200 and body.get("provider_id"):
            return SendResult(provider_id=str(body["provider_id"]), status=str(body.get("status") or "sent"))

        detail = f"CRM send {response.status_code}: {body.get('error') or response.text[:200]}"
        if body.get("opted_out"):
            raise ChannelSendError(detail, suppress=True, opted_out=True)
        if response.status_code in (401, 403):
            logger.error("The CRM rejected our shared secret: %s", detail)
            raise ChannelSendError(detail, retryable=False)
        if response.status_code == 429 or response.status_code >= 500:
            raise ChannelSendError(detail, retryable=body.get("retryable", True) is not False)
        raise ChannelSendError(detail, retryable=bool(body.get("retryable", False)))
