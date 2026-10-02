"""Delivery webhooks from Twilio and SendGrid (architecture §9, §11;
MASTER_PLAN_1 Stage 10).

  POST /v1/webhooks/twilio/status     Twilio's status callback for an SMS we sent
  POST /v1/webhooks/sendgrid/events   SendGrid's event webhook (delivered, bounce, unsubscribe, ...)

Auth is each provider's own signature, not the shared secret. A webhook whose
secret isn't configured rejects every call, so an unsigned request can never
change a message's status or a customer's consent.

Like the event routes, these only record what happened and queue work: a
failed message makes its follow-up due now and the follow-up job is queued;
the worker sends it (the API never sends, architecture §2).
"""

import base64
import hashlib
import hmac
import json
import logging
import uuid
from typing import Any
from urllib.parse import parse_qsl

from fastapi import APIRouter, HTTPException, Request, Response, status

from upsell_agent.channels import suppression
from upsell_agent.channels.delivery import DeliveryResult, apply_delivery_status, apply_unsubscribe

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])

# Twilio MessageStatus → our status word. `sending`/`receiving` are progress
# noise we don't need.
TWILIO_STATUS = {"queued": "queued", "accepted": "accepted", "sent": "sent", "delivered": "delivered",
                 "undelivered": "undelivered", "failed": "failed", "read": "opened"}
# SendGrid event → our status word. `deferred` means SendGrid is still trying.
SENDGRID_STATUS = {"processed": "accepted", "delivered": "delivered", "open": "opened",
                   "bounce": "bounced", "dropped": "dropped"}
SENDGRID_UNSUBSCRIBE = {"unsubscribe", "group_unsubscribe", "spamreport"}

FIRE_JOB = "fire_due_followups"


def twilio_signature(auth_token: str, url: str, params: dict[str, str]) -> str:
    """Twilio's request signature: HMAC-SHA1 over the full URL followed by
    every POST parameter name and value, sorted by name, base64-encoded."""
    payload = url + "".join(name + params[name] for name in sorted(params))
    digest = hmac.new(auth_token.encode(), payload.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def verify_sendgrid_signature(public_key_b64: str, signature_b64: str, timestamp: str, body: bytes) -> bool:
    """SendGrid's Signed Event Webhook: ECDSA P-256 / SHA-256 over the
    timestamp header followed by the raw body."""
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives.serialization import load_der_public_key

    try:
        key = load_der_public_key(base64.b64decode(public_key_b64))
        if not isinstance(key, ec.EllipticCurvePublicKey):
            return False
        key.verify(base64.b64decode(signature_b64), timestamp.encode() + body, ec.ECDSA(hashes.SHA256()))
    except (InvalidSignature, ValueError, TypeError):
        return False
    return True


def _public_url(request: Request) -> str:
    base = request.app.state.settings.public_base_url.rstrip("/")
    if not base:
        return str(request.url)
    query = f"?{request.url.query}" if request.url.query else ""
    return f"{base}{request.url.path}{query}"


async def _queue_followups(request: Request, results: list[DeliveryResult]) -> None:
    if any(r.followup_due_now for r in results):
        await request.app.state.enqueue(FIRE_JOB, key=f"{FIRE_JOB}:webhook:{uuid.uuid4().hex[:12]}")


@router.post("/twilio/status", status_code=status.HTTP_204_NO_CONTENT)
async def twilio_status(request: Request) -> Response:
    settings = request.app.state.settings
    params = dict(parse_qsl((await request.body()).decode(), keep_blank_values=True))
    if not settings.twilio_auth_token:
        logger.warning("Twilio status callback rejected: TWILIO_AUTH_TOKEN is not set")
        raise HTTPException(status_code=401, detail="Twilio webhook not configured")
    expected = twilio_signature(settings.twilio_auth_token, _public_url(request), params)
    if not hmac.compare_digest(expected, request.headers.get("X-Twilio-Signature", "")):
        raise HTTPException(status_code=401, detail="Bad Twilio signature")

    word = TWILIO_STATUS.get(params.get("MessageStatus", ""))
    sid = params.get("MessageSid") or params.get("SmsSid")
    if word and sid:
        error = params.get("ErrorCode") or None
        result = await apply_delivery_status(request.app.state.platform, word, provider_id=sid,
                                             error=f"Twilio error {error}" if error else None,
                                             hard=suppression.is_bad_number_error(error))
        logger.info("twilio status %s for %s: %s", word, sid, result.detail)
        await _queue_followups(request, [result])
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _sendgrid_ids(event: dict[str, Any]) -> tuple[str | None, str | None]:
    # sg_message_id is "<X-Message-Id>.<filter suffix>"; we store the
    # X-Message-Id. The idempotency key rides along as a custom arg
    # (channels/sendgrid.py) in case the id doesn't match.
    sg_id = event.get("sg_message_id")
    return (sg_id.split(".", 1)[0] if isinstance(sg_id, str) else None), event.get("ai_idempotency_key")


@router.post("/sendgrid/events")
async def sendgrid_events(request: Request) -> dict[str, Any]:
    settings = request.app.state.settings
    body = await request.body()
    if not settings.sendgrid_webhook_public_key:
        logger.warning("SendGrid event webhook rejected: SENDGRID_WEBHOOK_PUBLIC_KEY is not set")
        raise HTTPException(status_code=401, detail="SendGrid webhook not configured")
    signature = request.headers.get("X-Twilio-Email-Event-Webhook-Signature", "")
    timestamp = request.headers.get("X-Twilio-Email-Event-Webhook-Timestamp", "")
    if not (signature and timestamp and
            verify_sendgrid_signature(settings.sendgrid_webhook_public_key, signature, timestamp, body)):
        raise HTTPException(status_code=401, detail="Bad SendGrid signature")

    try:
        events = json.loads(body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Body must be a JSON array") from exc
    if not isinstance(events, list):
        raise HTTPException(status_code=400, detail="Body must be a JSON array")

    results: list[DeliveryResult] = []
    for event in events:
        if not isinstance(event, dict):
            continue
        kind = event.get("event")
        provider_id, key = _sendgrid_ids(event)
        if kind in SENDGRID_UNSUBSCRIBE:
            results.append(await apply_unsubscribe(provider_id=provider_id, idempotency_key=key,
                                                   source=f"sendgrid_{kind}"))
        elif kind in SENDGRID_STATUS:
            reason = event.get("reason") or event.get("response")
            results.append(await apply_delivery_status(
                request.app.state.platform, SENDGRID_STATUS[kind], provider_id=provider_id, idempotency_key=key,
                error=str(reason)[:300] if reason else None,
                hard=suppression.is_hard_bounce(kind, event_type=event.get("type"), reason=str(reason or ""))))
    await _queue_followups(request, results)
    return {"received": len(events), "applied": sum(1 for r in results if r.applied)}
