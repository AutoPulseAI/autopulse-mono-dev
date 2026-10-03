"""Everything this service needs from aidmvcs-be-dev, behind one interface.

- `stub`: builds Customer 360 from the platform's own collections in the
  local database (integrations/customer360.py, a port of the route) and
  records sent messages in dev_platform_messages. Lets the AI work run
  without the Next.js app.
- `live`: calls the real platform over HTTP with the shared secret.

Both implement the same contract, so switching PLATFORM_CLIENT is a config
change only. `python -m upsell_agent.devtools.compare_360` checks that stub
and live return the same Customer 360 for the seeded customers.

get_customer_360 returns the route's `data` object - customer,
value_snapshot, overview, leads, deals, repair_orders, appointments,
all_appointments, vehicles, trade_ins - or None when the customer doesn't
exist for that dealer.

Record-message contract (the platform side is
aidmvcs-be-dev/app/api/internal/ai/messages/route.js, BPLAN Phase 3):

    POST /api/internal/ai/messages
    {dealer_id, lead_id, customer_id, channel: "sms"|"email", to, text,
     subject, status: "sent"|"failed", provider_id, idempotency_key,
     turn_id, is_fallback, sent_at}
    → 200 {"id": "<Email _id>", "created": true|false}

It is idempotent on `idempotency_key`: recording the same send twice returns
the same Email record.

Booking contract (MASTER_PLAN_3 B5; the platform side is
aidmvcs-be-dev/app/api/booking/route.js, unchanged by this plan):

    POST /api/booking
    {dealer_id, lead_id, customerName, email, phone, bookingDate: "YYYY-MM-DD"
     (dealer-local), bookingTime: "HH:MM" (24h, dealer-local), notes,
     dealer_timezone (stub only, to place bookingDate at dealer-local
     midnight the way the route's own moment-tz call does)}
    → 200 {"booking_id": str, "booking_status": "pending"}

    PUT /api/booking
    {booking_id, booking_status: "pending"|"confirmed"|"cancelled"|
     "completed", booking_date?, booking_time?, dealer_timezone (stub only)}
    → 200 {"booking_id": str, "booking_status": str}

`booking_id`/`booking_status` are the AI service's own snake_case names for
the route's `bookingId`/`booking_status` fields; `LivePlatformClient`
translates between them. Availability is read separately, straight from the
platform's `bookings` collection (tools/booking_tool.py, architecture §15
decision 103) - never through this client, and never cached, since a stale
read here could double-book a slot.
"""

from datetime import UTC, date, datetime, time
from typing import Any, Protocol
from zoneinfo import ZoneInfo

import httpx

from upsell_agent import clock
from upsell_agent.config import Settings
from upsell_agent.integrations.customer360 import EMPTY_360, build_customer_360
from upsell_agent.integrations.mongodb import (
    PLATFORM_BOOKINGS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    as_object_id,
    dealer_scoped_db,
)

DEV_PLATFORM_MESSAGES_COLLECTION = "dev_platform_messages"
__all__ = ["EMPTY_360", "LivePlatformClient", "PlatformClient", "PlatformError", "SlotTakenError",
           "StubPlatformClient", "get_platform_client"]

RECORD_TIMEOUT_S = 5.0


class PlatformError(RuntimeError):
    """The platform answered, but not with success."""


class SlotTakenError(PlatformError):
    """`POST/PUT /api/booking` answered 409: the slot is full (the CRM's own
    capacity check, aidmvcs-be-dev app/lib/bookingService.js, PLAN_4 C1).
    `alternatives` are that day's free "HH:MM" times, as the CRM sees them."""

    def __init__(self, message: str, alternatives: list[str] | None = None) -> None:
        super().__init__(message)
        self.alternatives = alternatives or []


class PlatformClient(Protocol):
    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict[str, Any] | None: ...

    async def record_message(self, dealer_id: str, message: dict[str, Any]) -> str: ...

    async def update_message_status(self, dealer_id: str, provider_id: str, status: str) -> bool: ...

    async def create_booking(self, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]: ...

    async def update_booking(self, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]: ...

    async def mark_lead_dnd(self, dealer_id: str, lead_id: str, reason: str) -> bool: ...


def _dealer_local_midnight_utc(booking_date: str, dealer_timezone: str) -> datetime:
    """The same value route.js's `moment.tz(bookingDate, 'YYYY-MM-DD',
    dealerTimezone).startOf('day').utc().toDate()` computes: `bookingDate`
    placed at dealer-local midnight, in UTC."""
    local_midnight = datetime.combine(date.fromisoformat(booking_date), time(0), tzinfo=ZoneInfo(dealer_timezone))
    return local_midnight.astimezone(UTC)


class StubPlatformClient:
    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict[str, Any] | None:
        return await build_customer_360(dealer_id, customer_id)

    async def record_message(self, dealer_id: str, message: dict[str, Any]) -> str:
        messages = dealer_scoped_db(dealer_id).collection(DEV_PLATFORM_MESSAGES_COLLECTION)
        await messages.update_one(
            {"idempotency_key": message["idempotency_key"]},
            {"$setOnInsert": {**message, "recorded_at": clock.now()}},
            upsert=True,
        )
        doc = await messages.find_one({"idempotency_key": message["idempotency_key"]})
        return str(doc["_id"])

    async def record_note(self, dealer_id: str, note: dict[str, Any]) -> str:
        """MASTER_PLAN_4 F2: a staff-only note on the lead's conversation (a service request and its notes),
        never sent to the customer. Stub only: the platform's notes route needs a staff login, and there's
        no internal one for this service yet (stream_A1.md, open items), so the live client has none."""
        messages = dealer_scoped_db(dealer_id).collection(DEV_PLATFORM_MESSAGES_COLLECTION)
        await messages.update_one(
            {"idempotency_key": note["idempotency_key"]},
            {"$setOnInsert": {**note, "is_note": True, "recorded_at": clock.now()}}, upsert=True)
        doc = await messages.find_one({"idempotency_key": note["idempotency_key"]})
        return str(doc["_id"])

    async def update_message_status(self, dealer_id: str, provider_id: str, status: str) -> bool:
        result = await dealer_scoped_db(dealer_id).collection(DEV_PLATFORM_MESSAGES_COLLECTION).update_one(
            {"provider_id": provider_id}, {"$set": {"delivery_status": status, "status_at": clock.now()}}
        )
        return result.matched_count > 0

    async def create_booking(self, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Writes the same shape `POST /api/booking` does (architecture §15
        decision 102): a `Booking` document, plus the lead's booking fields.
        Sends no confirmation itself (Compose's reply is the confirmation)
        and creates no reminders (the dev stub has no reminder service)."""
        db = dealer_scoped_db(dealer_id)
        now = clock.now()
        booking_date_utc = _dealer_local_midnight_utc(payload["bookingDate"], payload["dealer_timezone"])
        doc = {
            "dealer_id": dealer_id, "lead_id": payload["lead_id"], "customerName": payload["customerName"],
            "email": payload["email"], "phone": payload["phone"], "bookingDate": booking_date_utc,
            "bookingTime": payload["bookingTime"], "notes": payload.get("notes"), "booking_status": "pending",
            "createdAt": now, "updatedAt": now,
        }
        inserted = await db.collection(PLATFORM_BOOKINGS_COLLECTION).insert_one(doc)
        booking_id = str(inserted.inserted_id)
        await db.collection(PLATFORM_LEADS_COLLECTION).update_one(
            {"_id": as_object_id(payload["lead_id"])},
            {"$set": {"data.bookingId": booking_id, "status": "Appointment Booked",
                      "statusChangedAt": now, "data.booking.booking_date": booking_date_utc,
                      "data.booking.booking_time": payload["bookingTime"]}},
        )
        return {"booking_id": booking_id, "booking_status": "pending"}

    async def update_booking(self, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Writes the same shape `PUT /api/booking` does. Mirrors the
        platform's own known gaps (B5, architecture §15 decisions 58-59): a
        cancel here doesn't change the lead's status or touch reminders
        either - the AI's own lead state and the team notice carry that."""
        db = dealer_scoped_db(dealer_id)
        update: dict[str, Any] = {"updatedAt": clock.now()}
        if payload.get("booking_status") is not None:
            update["booking_status"] = payload["booking_status"]
        if payload.get("booking_date"):
            update["bookingDate"] = _dealer_local_midnight_utc(payload["booking_date"], payload["dealer_timezone"])
        if payload.get("booking_time"):
            update["bookingTime"] = payload["booking_time"]
        if isinstance(payload.get("showed"), bool):
            update["showed"], update["showed_at"] = payload["showed"], clock.now()
        await db.collection(PLATFORM_BOOKINGS_COLLECTION).update_one(
            {"_id": as_object_id(payload["booking_id"])}, {"$set": update})
        doc = await db.collection(PLATFORM_BOOKINGS_COLLECTION).find_one({"_id": as_object_id(payload["booking_id"])})
        return {"booking_id": payload["booking_id"], "booking_status": (doc or {}).get("booking_status")}

    async def mark_lead_dnd(self, dealer_id: str, lead_id: str, reason: str) -> bool:
        """Writes what `POST /api/internal/ai/leads/dnd` does: the lead's CRM status DND, and a note."""
        db = dealer_scoped_db(dealer_id)
        result = await db.collection(PLATFORM_LEADS_COLLECTION).update_one(
            {"_id": as_object_id(lead_id)},
            {"$set": {"status": "DND", "lead_status": "DND", "fe_lead_status": "DND", "statusChangedAt": clock.now(),
                      "dnd_source": "ai_opt_out", "dnd_reason": reason}})
        return result.matched_count > 0


class LivePlatformClient:
    def __init__(self, settings: Settings):
        self._base_url = settings.autopulse_api_base_url.rstrip("/")
        self._headers = {"Authorization": f"Bearer {settings.upsell_service_shared_secret}"}

    async def get_customer_360(self, dealer_id: str, customer_id: str) -> dict[str, Any] | None:
        async with httpx.AsyncClient(timeout=RECORD_TIMEOUT_S) as client:
            response = await client.get(f"{self._base_url}/api/customers/{customer_id}/360",
                                        params={"dealer_id": dealer_id}, headers=self._headers)
        if response.status_code in (400, 404):
            return None
        if response.status_code >= 400:
            raise PlatformError(f"GET customer 360 → {response.status_code}: {response.text[:300]}")
        return response.json().get("data")

    async def record_message(self, dealer_id: str, message: dict[str, Any]) -> str:
        body = await self._post("/api/internal/ai/messages", {**message, "dealer_id": dealer_id})
        return str(body["id"])

    async def update_message_status(self, dealer_id: str, provider_id: str, status: str) -> bool:
        body = await self._post(
            "/api/internal/ai/messages/status",
            {"dealer_id": dealer_id, "provider_id": provider_id, "status": status},
        )
        return bool(body.get("updated"))

    async def create_booking(self, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """`POST /api/booking` (unchanged by this plan): creates the
        `Booking`, sets the lead to "Appointment Booked", and sends the
        platform's own confirmation SMS/email + reminders (route.js).
        `dealer_timezone` is stub-only and dropped here; the route works out
        the dealer's timezone itself."""
        body = await self._post("/api/booking", {
            "dealer_id": dealer_id, "lead_id": payload["lead_id"], "customerName": payload["customerName"],
            "email": payload["email"], "phone": payload["phone"], "bookingDate": payload["bookingDate"],
            "bookingTime": payload["bookingTime"], "notes": payload.get("notes"),
        })
        return {"booking_id": str(body.get("bookingId") or (body.get("booking") or {}).get("_id") or ""),
                "booking_status": (body.get("booking") or {}).get("booking_status", "pending")}

    async def update_booking(self, dealer_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        """`PUT /api/booking`: `booking_status` must always be sent, even
        unchanged - without it a date/time change is silently ignored
        (route.js, checked against the running code, B5 item 3)."""
        body = await self._post("/api/booking", {
            "bookingId": payload["booking_id"], "booking_status": payload["booking_status"],
            **({"booking_date": payload["booking_date"]} if payload.get("booking_date") else {}),
            **({"booking_time": payload["booking_time"]} if payload.get("booking_time") else {}),
            **({"showed": payload["showed"]} if isinstance(payload.get("showed"), bool) else {}),
        }, method="PUT")
        return {"booking_id": payload["booking_id"],
                "booking_status": (body.get("booking") or {}).get("booking_status", payload["booking_status"])}

    async def mark_lead_dnd(self, dealer_id: str, lead_id: str, reason: str) -> bool:
        """`POST /api/internal/ai/leads/dnd`: the customer opted out of every channel, so the CRM shows the
        lead as DND with a note, and its own follow-ups and reminders stop (PLAN_4 stream C1)."""
        body = await self._post("/api/internal/ai/leads/dnd",
                                {"dealer_id": dealer_id, "lead_id": lead_id, "reason": reason})
        return bool(body.get("updated"))

    async def add_lead_note(self, dealer_id: str, lead_id: str, text: str, kind: str | None = None) -> str:
        """`POST /api/internal/ai/leads/notes`: an internal note on the lead, visible to staff in the CRM
        (e.g. a service request with the customer's preferred day and time)."""
        body = await self._post("/api/internal/ai/leads/notes",
                                {"dealer_id": dealer_id, "lead_id": lead_id, "text": text, "kind": kind})
        return str(body.get("id") or "")

    async def _post(self, path: str, payload: dict[str, Any], method: str = "POST") -> dict[str, Any]:
        async with httpx.AsyncClient(timeout=RECORD_TIMEOUT_S) as client:
            response = await client.request(method, f"{self._base_url}{path}", json=payload, headers=self._headers)
        if response.status_code == 409 and path == "/api/booking":
            try:
                body = response.json()
            except ValueError:
                body = {}
            raise SlotTakenError(f"{method} {path} → 409: {body.get('message') or response.text[:300]}",
                                 alternatives=body.get("alternatives"))
        if response.status_code >= 400:
            raise PlatformError(f"{method} {path} → {response.status_code}: {response.text[:300]}")
        return response.json()


def get_platform_client(settings: Settings) -> PlatformClient:
    if settings.platform_client == "stub":
        return StubPlatformClient()
    return LivePlatformClient(settings)
