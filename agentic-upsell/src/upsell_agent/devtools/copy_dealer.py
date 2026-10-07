"""Make a DEV copy of one dealer's data (MASTER_PLAN_1 Stage 13: shadow drafts
are compared "on a DEV copy of the data, never against production").

    make ai-copy-dealer FROM="mongodb://readonly@prod-host/pulse" DEALER=<id> DAYS=7
    make ai-copy-dealer FROM=... DEALER=<id> DAYS=7 REPLAY=1

Copies, for leads created in the last DAYS days: the dealer record (no
password), its mailboxes (no passwords), leads, customers, the conversation
(`emails`), DMS history (vehicles, deals, repair orders, appointments,
trade-ins), campaigns, and the AI's own records for that dealer (messages,
turns, lead state, facts, follow-ups) - so the Shadow tab can show what the AI
drafted next to what n8n actually sent.

Safety:
- the source is only ever read; the destination must be the local dev MongoDB;
- ENVIRONMENT must be DEV;
- phone numbers and email addresses are masked by default (the same value always
  becomes the same masked value, so threads still line up; the dealer's own
  number and mailbox are kept). Message texts are copied as they are.

REPLAY=1 then runs the copied conversations through the local AI in shadow
mode (in time order, one turn at a time per lead), for comparing the AI with
n8n before a dealer is even switched to shadow.
"""

import argparse
import asyncio
import hashlib
import re
import sys
from datetime import timedelta
from urllib.parse import urlparse

from bson import ObjectId

from upsell_agent import clock
from upsell_agent.config import get_settings
from upsell_agent.integrations.mongodb import (
    AI_LEAD_STATE_COLLECTION,
    AI_MESSAGES_COLLECTION,
    AI_TURN_LOG_COLLECTION,
    PLATFORM_CUSTOMERS_COLLECTION,
    PLATFORM_DEALS_COLLECTION,
    PLATFORM_EMAIL_ACCOUNTS_COLLECTION,
    PLATFORM_LEADS_COLLECTION,
    PLATFORM_REPAIR_ORDERS_COLLECTION,
    PLATFORM_SERVICE_APPOINTMENTS_COLLECTION,
    PLATFORM_TRADE_INS_COLLECTION,
    PLATFORM_USERS_COLLECTION,
    PLATFORM_VEHICLES_COLLECTION,
    QUALIFICATION_FACTS_COLLECTION,
    SCHEDULED_FOLLOWUPS_COLLECTION,
)

LOCAL_HOSTS = {"localhost", "127.0.0.1", "mongodb", "autopulse-mongo"}
PLATFORM_EMAILS_COLLECTION = "emails"
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_DEALER_FIELDS = ("name", "type", "ai_mode", "setting", "dealer_account_information")


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


class Masker:
    """Same input -> same masked output, so a customer's messages still line up."""

    def __init__(self, keep: set[str]):
        self.keep = {k.lower() for k in keep if k}

    def email(self, value: str | None) -> str | None:
        if not value or value.lower() in self.keep:
            return value
        return f"c{_digest(value.lower())[:10]}@masked.invalid"

    def phone(self, value: str | None) -> str | None:
        if not value:
            return value
        digits = re.sub(r"\D", "", str(value))[-10:]
        if len(digits) < 10 or value in self.keep or f"+1{digits}" in self.keep:
            return value
        masked = "555" + f"{int(_digest(digits)[:12], 16) % 10**7:07d}"
        return f"+1{masked}" if str(value).startswith("+") else masked

    def address(self, value: str | None) -> str | None:
        """An email sender/recipient ("Name <a@b>" or a@b) or a phone number."""
        if not value:
            return value
        if "@" in value:
            return _EMAIL.sub(lambda m: self.email(m.group(0)), value)
        return self.phone(value) if re.search(r"\d{7,}", re.sub(r"\D", "", value)) else value

    def customer(self, doc: dict) -> dict:
        doc = dict(doc)
        doc["emails"] = [{**e, "value": self.email(e.get("value"))} for e in doc.get("emails") or []]
        doc["phones"] = [{**p, "value": self.phone(p.get("value"))} for p in doc.get("phones") or []]
        return doc

    def lead(self, doc: dict) -> dict:
        doc = dict(doc)
        doc["email"], doc["phone"] = self.email(doc.get("email")), self.phone(doc.get("phone"))
        if isinstance(doc.get("data"), dict):
            data = dict(doc["data"])
            data["email"], data["phone"] = self.email(data.get("email")), self.phone(data.get("phone"))
            doc["data"] = data
        return doc

    def message(self, doc: dict) -> dict:
        doc = dict(doc)
        doc["sender"], doc["recipient"] = self.address(doc.get("sender")), self.address(doc.get("recipient"))
        return doc

    def ai_message(self, doc: dict) -> dict:
        doc = dict(doc)
        if "to" in doc:
            doc["to"] = self.address(doc.get("to"))
        return doc


async def _upsert_all(dest, name: str, docs: list[dict]) -> int:
    for doc in docs:
        await dest[name].replace_one({"_id": doc["_id"]}, doc, upsert=True)
    return len(docs)


async def copy_dealer(source, dest, dealer_id: str, *, days: float, mask: bool = True) -> dict[str, int]:
    """Copies one dealer's recent data from `source` to `dest` (motor
    databases). Only reads from `source`. Returns counts per collection."""
    oid = ObjectId(dealer_id)
    either = {"$in": [dealer_id, oid]}
    since = clock.now() - timedelta(days=days)
    counts: dict[str, int] = {}

    dealer = await source[PLATFORM_USERS_COLLECTION].find_one({"_id": oid})
    if dealer is None:
        raise LookupError(f"dealer {dealer_id} not found in the source database")
    dealer = {"_id": oid, **{k: dealer[k] for k in _DEALER_FIELDS if k in dealer},
              "password": "!dev-copy-no-login", "email": f"dealer-{dealer_id}@copy.invalid", "dev_copy": True}
    accounts = [{**{k: v for k, v in a.items() if k != "email_password"}, "email_password": "!dev-copy",
                 "dev_copy": True}
                for a in await source[PLATFORM_EMAIL_ACCOUNTS_COLLECTION].find({"dealer_id": either}).to_list(None)]
    keep = {(dealer.get("dealer_account_information") or {}).get("sms_conversion_phone")}
    keep |= {a.get("email_address") for a in accounts}
    masker = Masker({k for k in keep if k}) if mask else None

    counts["users"] = await _upsert_all(dest, PLATFORM_USERS_COLLECTION, [dealer])
    counts["emailaccounts"] = await _upsert_all(dest, PLATFORM_EMAIL_ACCOUNTS_COLLECTION, accounts)

    leads = await source[PLATFORM_LEADS_COLLECTION].find(
        {"dealer_id": either, "createdAt": {"$gte": since}}).to_list(None)
    lead_ids = [lead["_id"] for lead in leads]
    customer_ids = list({lead["customer_id"] for lead in leads if lead.get("customer_id")})
    customer_ids = customer_ids + [ObjectId(c) for c in customer_ids if isinstance(c, str) and ObjectId.is_valid(c)]
    customers = await source[PLATFORM_CUSTOMERS_COLLECTION].find(
        {"_id": {"$in": customer_ids}, "dealer_id": either}).to_list(None)
    emails = await source[PLATFORM_EMAILS_COLLECTION].find(
        {"dealer_id": either, "lead_id": {"$in": lead_ids}}).to_list(None)
    counts["leads"] = await _upsert_all(dest, PLATFORM_LEADS_COLLECTION,
                                        [masker.lead(d) if masker else d for d in leads])
    counts["customers"] = await _upsert_all(dest, PLATFORM_CUSTOMERS_COLLECTION,
                                            [masker.customer(d) if masker else d for d in customers])
    counts["emails"] = await _upsert_all(dest, PLATFORM_EMAILS_COLLECTION,
                                         [masker.message(d) if masker else d for d in emails])

    history_ids = [c["_id"] for c in customers] + [str(c["_id"]) for c in customers]
    for name, dealer_field in ((PLATFORM_DEALS_COLLECTION, "dealer_id"),
                               (PLATFORM_REPAIR_ORDERS_COLLECTION, "dealer_id"),
                               (PLATFORM_SERVICE_APPOINTMENTS_COLLECTION, "dealer_id"),
                               (PLATFORM_TRADE_INS_COLLECTION, "dealer_id")):
        docs = await source[name].find({dealer_field: either, "customer_id": {"$in": history_ids}}).to_list(None)
        counts[name] = await _upsert_all(dest, name, docs)
    vins = list({d.get("vin") for n in (PLATFORM_DEALS_COLLECTION, PLATFORM_REPAIR_ORDERS_COLLECTION)
                 for d in await dest[n].find({"dealer_id": either}).to_list(None) if d.get("vin")})
    counts[PLATFORM_VEHICLES_COLLECTION] = await _upsert_all(
        dest, PLATFORM_VEHICLES_COLLECTION,
        await source[PLATFORM_VEHICLES_COLLECTION].find({"dealerId": either, "vin": {"$in": vins}}).to_list(None))

    campaigns = await source["campaigns"].find({"dealer_id": either}).to_list(None)
    counts["campaigns"] = await _upsert_all(dest, "campaigns", campaigns)
    counts["campaignleads"] = await _upsert_all(
        dest, "campaignleads",
        await source["campaignleads"].find({"dealer_id": either, "lead_id": {"$in": lead_ids}}).to_list(None))

    str_lead_ids = [str(lid) for lid in lead_ids]
    for name in (AI_MESSAGES_COLLECTION, AI_TURN_LOG_COLLECTION, AI_LEAD_STATE_COLLECTION,
                 SCHEDULED_FOLLOWUPS_COLLECTION):
        docs = await source[name].find({"dealer_id": dealer_id, "lead_id": {"$in": str_lead_ids}}).to_list(None)
        if masker and name == AI_MESSAGES_COLLECTION:
            docs = [masker.ai_message(d) for d in docs]
        counts[name] = await _upsert_all(dest, name, docs)
    counts[QUALIFICATION_FACTS_COLLECTION] = await _upsert_all(
        dest, QUALIFICATION_FACTS_COLLECTION,
        await source[QUALIFICATION_FACTS_COLLECTION].find(
            {"dealer_id": dealer_id, "customer_id": {"$in": [str(c["_id"]) for c in customers]}}).to_list(None))
    return counts


async def replay(dest, dealer_id: str, lead_ids: list, enqueue, *, turn_timeout_s: float = 30) -> dict[str, int]:
    """Runs the copied conversations through the local AI as shadow events,
    oldest first, waiting for each turn before the lead's next message."""
    from upsell_agent.events.intake import accept_event
    from upsell_agent.events.models import InboundMessageEvent, LeadCreatedEvent

    sent = {"leads": 0, "messages": 0}
    leads = await dest[PLATFORM_LEADS_COLLECTION].find({"_id": {"$in": lead_ids}}).to_list(None)
    leads.sort(key=lambda d: d.get("createdAt") or d["_id"].generation_time)
    turns = dest[AI_TURN_LOG_COLLECTION]

    async def wait_for(lead_id: str, count: int) -> None:
        deadline = asyncio.get_running_loop().time() + turn_timeout_s
        while await turns.count_documents({"dealer_id": dealer_id, "lead_id": lead_id}) < count:
            if asyncio.get_running_loop().time() > deadline:
                return
            await asyncio.sleep(0.25)

    for lead in leads:
        lead_id, customer_id = str(lead["_id"]), str(lead.get("customer_id") or "")
        if not customer_id:
            continue
        before = await turns.count_documents({"dealer_id": dealer_id, "lead_id": lead_id})
        channel = "email" if not lead.get("phone") and lead.get("email") else "sms"
        await accept_event("lead-created", LeadCreatedEvent(
            event_id=f"replay-{lead_id}", dealer_id=dealer_id, lead_id=lead_id, customer_id=customer_id,
            channel=channel, shadow=True), enqueue)
        sent["leads"] += 1
        before += 1
        await wait_for(lead_id, before)
        inbound = await dest[PLATFORM_EMAILS_COLLECTION].find(
            {"lead_id": lead["_id"], "status": {"$in": ["incoming", "received"]}}).to_list(None)
        inbound.sort(key=lambda m: m.get("timestamp") or m.get("date"))
        for message in inbound:
            await accept_event("inbound-message", InboundMessageEvent(
                event_id=f"replay-{message['_id']}", dealer_id=dealer_id, customer_id=customer_id, lead_id=lead_id,
                channel="sms" if message.get("communication_type") == "sms" else "email",
                message_id=str(message["_id"]), text=message.get("mail_content") or "",
                received_at=message.get("timestamp") or message.get("date") or clock.now(), shadow=True), enqueue)
            sent["messages"] += 1
            before += 1
            await wait_for(lead_id, before)
    return sent


async def _cli(args: argparse.Namespace) -> int:
    from motor.motor_asyncio import AsyncIOMotorClient

    settings = get_settings()
    if not settings.is_dev:
        print("Refusing: ENVIRONMENT must be DEV.")
        return 2
    dest_uri = settings.mongodb_uri
    if (urlparse(dest_uri).hostname or "") not in LOCAL_HOSTS:
        print(f"Refusing: the destination {urlparse(dest_uri).hostname!r} is not the local dev database.")
        return 2
    if args.source == dest_uri:
        print("Refusing: the source and destination are the same database.")
        return 2
    source_client = AsyncIOMotorClient(args.source, serverSelectionTimeoutMS=10_000)
    dest_client = AsyncIOMotorClient(dest_uri)
    try:
        source, dest = source_client.get_default_database(), dest_client.get_default_database()
        counts = await copy_dealer(source, dest, args.dealer, days=args.days, mask=not args.no_mask)
        print(f"Copied dealer {args.dealer} (last {args.days:g} days, contacts "
              f"{'kept' if args.no_mask else 'masked'}): " + ", ".join(f"{k} {v}" for k, v in counts.items()))
        if args.replay:
            from upsell_agent.integrations import mongodb
            from upsell_agent.worker.queue import make_enqueue, make_queue

            await mongodb.init_mongo(settings)
            queue = make_queue(settings)
            await queue.connect()
            try:
                since = clock.now() - timedelta(days=args.days)
                lead_ids = [d["_id"] for d in await dest[PLATFORM_LEADS_COLLECTION].find(
                    {"dealer_id": {"$in": [args.dealer, ObjectId(args.dealer)]}, "createdAt": {"$gte": since}},
                    projection={"_id": 1}).to_list(None)]
                replayed = await replay(dest, args.dealer, lead_ids, make_enqueue(queue))
                print(f"Replayed {replayed['leads']} lead(s) and {replayed['messages']} message(s) in shadow mode; "
                      "see the Debug UI Shadow tab.")
            finally:
                await queue.disconnect()
                await mongodb.close_mongo()
    finally:
        source_client.close()
        dest_client.close()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Copy one dealer's data into the local dev database")
    parser.add_argument("--from", dest="source", required=True, help="source MongoDB URI (read only)")
    parser.add_argument("--dealer", required=True)
    parser.add_argument("--days", type=float, default=7)
    parser.add_argument("--replay", action="store_true", help="replay the conversations through the AI in shadow mode")
    parser.add_argument("--no-mask", action="store_true", help="keep real phone numbers and email addresses")
    return asyncio.run(_cli(parser.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
