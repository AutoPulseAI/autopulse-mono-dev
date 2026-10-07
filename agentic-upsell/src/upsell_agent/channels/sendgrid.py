"""Live email through SendGrid's v3 Mail Send API (MASTER_PLAN_1 Stage 12).

From the dealer's mailbox (or SENDGRID_FROM_EMAIL when dealer domains aren't
authenticated in SendGrid), with reply-to set to the dealer's mailbox so the
customer's answer comes back through the platform's Mailgun inbound route
(architecture §15). The idempotency key rides along as a custom arg, so the
event webhook can find the message even if the id doesn't match. A vehicle
photo (MASTER_PLAN_4 F3) is shown inline in the HTML part.

SendGrid answers 202 with the message id in the X-Message-Id header.
Failures: network error, timeout, 429, 5xx are retryable; other 4xx permanent.
"""

import html
import logging

import httpx

from upsell_agent.channels.base import ChannelSendError, OutboundMessage, SendResult
from upsell_agent.channels.dealer_identity import dealer_identity

logger = logging.getLogger(__name__)

TIMEOUT_S = 10.0


def _html(text: str, media_urls: tuple[str, ...] = ()) -> str:
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    body = [f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>" for p in paragraphs]
    if media_urls:
        # MASTER_PLAN_4 F3: the vehicle's photo inline, right after the greeting, so it's the first thing they
        # see. Referenced by its (already checked) https URL rather than attached.
        images = "".join(f'<p><img src="{html.escape(u, quote=True)}" alt="The vehicle" '
                         'style="max-width:100%;height:auto"></p>' for u in media_urls)
        body.insert(min(1, len(body)), images)
    return "".join(body)


class SendGridEmailDriver:
    name = "sendgrid"

    def __init__(self, *, api_key: str, api_base: str = "https://api.sendgrid.com", from_email: str = "",
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        if not api_key:
            raise ValueError("SENDGRID_API_KEY is required for live email")
        self._url = f"{api_base.rstrip('/')}/v3/mail/send"
        self._headers = {"Authorization": f"Bearer {api_key}"}
        self._from_email = from_email
        self._transport = transport

    def payload(self, message: OutboundMessage, *, sender: str, reply_to: str | None, name: str | None) -> dict:
        body = {
            "personalizations": [{
                "to": [{"email": message.to}],
                "custom_args": {"ai_idempotency_key": message.idempotency_key or "", "dealer_id": message.dealer_id},
            }],
            "from": {"email": sender, **({"name": name} if name else {})},
            "subject": message.subject or "A message from your dealership",
            "content": [{"type": "text/plain", "value": message.text},
                        {"type": "text/html", "value": _html(message.text, message.media_urls)}],
        }
        if reply_to:
            body["reply_to"] = {"email": reply_to}
        return body

    async def send(self, message: OutboundMessage) -> SendResult:
        identity = await dealer_identity(message.dealer_id)
        sender = self._from_email or identity.mailbox
        if not sender:
            raise ChannelSendError("dealer has no mailbox (EmailAccount) and SENDGRID_FROM_EMAIL is not set",
                                   retryable=False)
        body = self.payload(message, sender=sender, reply_to=identity.mailbox or sender, name=identity.name)
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_S, transport=self._transport) as client:
                response = await client.post(self._url, json=body, headers=self._headers)
        except httpx.HTTPError as exc:
            raise ChannelSendError(f"SendGrid unreachable: {exc!r}", retryable=True) from exc

        if response.status_code in (200, 202):
            message_id = response.headers.get("X-Message-Id")
            if not message_id:
                raise ChannelSendError("SendGrid accepted the email but returned no X-Message-Id", retryable=False)
            return SendResult(provider_id=message_id, status="accepted")
        try:
            errors = response.json().get("errors") or []
        except ValueError:
            errors = []
        detail = f"SendGrid {response.status_code}" + (
            ": " + "; ".join(str(e.get("message")) for e in errors) if errors else "")
        if response.status_code == 429 or response.status_code >= 500:
            raise ChannelSendError(detail, retryable=True)
        if response.status_code in (401, 403):
            logger.error("SendGrid rejected our API key: %s", detail)
        raise ChannelSendError(detail, retryable=False)
