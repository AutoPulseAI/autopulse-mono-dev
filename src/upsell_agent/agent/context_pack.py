"""The context pack (MASTER_PLAN_2 Phase 1): everything the AI steps know
about a turn, built once in Load context. Extract and Compose read the same
pack, so they can't disagree about the turn, and the Debug UI shows it.

Layers:
  now             the dealer's local date, weekday, time and timezone
  dealer          name, timezone and `info`: what may be told to a customer
                  (address, phone, website, opening hours; `missing` = the
                  team will confirm). From the dealer's platform record.
  about_customer  what we may say we know about the customer: confirmed
                  values in plain words, and those still to confirm
  customer        first name, and the channel this turn replies on
  lead_type / profile  slots and their state; values pre-filled from
                  Customer 360 carry source "platform" (long-term memory)
  new_messages    the customer messages this turn answers, one by one
  working_memory  the conversation before them, word for word, within a
                  token budget (the newest MIN_RECENT always kept)
  summary         older turns, folded in after the send (agent/summary.py)
  conversation    asks, open questions, promises (agent/conversation.py)
  campaign        the campaign the customer is replying to, if any
  inventory       stock records loaded this turn, each with its VIN as
                  `source_id`, the criteria used (`inventory_query`) and when
                  they were loaded (`inventory_checked_at`); MASTER_PLAN_3
                  Phase 1, tools/inventory_tool.py. Held back from the models
                  (HELD_FROM_MODELS) until the grounding check (Phase 4) can
                  catch a wrong vehicle fact.

Tokens are estimated at CHARS_PER_TOKEN characters each: close enough for a
budget, and it needs no tokenizer download.
"""

import math
import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from upsell_agent.agent.conversation import ConversationState
from upsell_agent.slots.display import about_customer, display_value
from upsell_agent.slots.schema import SCHEMA

CHARS_PER_TOKEN = 4
# Always kept, whatever the budget: enough to know what was just asked and answered.
MIN_RECENT = 6
# Messages read from MongoDB per turn, newest first.
LOAD_LIMIT = 60
# One message longer than this is cut, so a pasted essay can't take the budget.
MAX_MESSAGE_CHARS = 2000
TRIMMED = " …[trimmed]"
# Pack layers the models don't see yet. Shown in the Debug UI all the same.
HELD_FROM_MODELS = frozenset({"budget", "inventory", "inventory_query", "inventory_checked_at"})


class PackMessage(BaseModel):
    direction: Literal["inbound", "outbound"]
    channel: str
    text: str
    at: str | None = None
    # "lead_form": a new lead's comments, not a message in the thread.
    source: Literal["message", "lead_form"] = "message"
    # An outbound message re-sent on the other channel by the 24h switch.
    resend: bool = False


class PackBudget(BaseModel):
    working_tokens: int
    working_used: int
    loaded: int
    kept: int
    dropped: int
    more_not_loaded: bool
    trimmed_messages: int
    # Messages outside working memory that the summary doesn't cover yet: the
    # turn queues a summary update after its send.
    summary_behind: bool = False
    summary_covers: int = 0
    tokens: dict[str, int] = Field(default_factory=dict)


class ContextPack(BaseModel):
    now: dict[str, str]
    dealer: dict[str, Any]
    customer: dict[str, Any]
    lead_type: str
    profile: list[dict[str, Any]]
    about_customer: dict[str, list[dict[str, str]]] = Field(default_factory=dict)
    new_messages: list[PackMessage]
    working_memory: list[PackMessage]
    summary: str | None = None
    conversation: ConversationState
    campaign: dict[str, Any] | None = None
    inventory: list[dict[str, Any]] = Field(default_factory=list)
    inventory_query: dict[str, Any] | None = None
    inventory_checked_at: str | None = None
    budget: PackBudget

    def for_prompt(self) -> dict[str, Any]:
        """What the models see: everything but the budget bookkeeping and
        the layers still held back (HELD_FROM_MODELS)."""
        return self.model_dump(exclude=set(HELD_FROM_MODELS), mode="json")

    def customer_text(self) -> str:
        """The new messages as one text: what Extract reads and Validate
        checks quotes against."""
        return "\n".join(m.text for m in self.new_messages if m.text)

    def last_ai_message(self) -> PackMessage | None:
        return next((m for m in reversed(self.working_memory) if m.direction == "outbound"), None)


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / CHARS_PER_TOKEN) if text else 0


# --- Cleaning a customer's email ----------------------------------------------

# The line a mail client puts above the quoted earlier message. Gmail wraps a
# long one over two lines, so "wrote:" may sit on the next line.
_REPLY_HEADER = re.compile(r"(?im)^[ \t]*On\b[^\n]{0,300}(?:\n[^\n]{0,200})?\bwrote:[ \t]*$")
_ORIGINAL = re.compile(r"(?im)^[ \t]*-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}.*$")
_OUTLOOK_RULE = re.compile(r"(?m)^[ \t]*_{10,}[ \t]*$")
_OUTLOOK_HEADER = re.compile(r"(?im)^[ \t]*From:[^\n]*\n(?:[^\n]*\n){0,3}?[ \t]*(?:Sent|Date):")
_SIGNATURE = re.compile(r"(?m)^(?:--|-- )[ \t]*$")
_DEVICE_LINE = re.compile(r"(?im)^[ \t]*(?:Sent from my \w[^\n]*|Get Outlook for \w[^\n]*)$")


def clean_email_text(text: str) -> str:
    """The customer's own words in an email reply: the quoted earlier
    message, forwarded blocks and the signature removed. Returns the text
    unchanged (trimmed) if cleaning would leave nothing."""
    if not text:
        return ""
    cut = len(text)
    for pattern in (_REPLY_HEADER, _ORIGINAL, _OUTLOOK_RULE, _OUTLOOK_HEADER, _SIGNATURE):
        match = pattern.search(text)
        if match:
            cut = min(cut, match.start())
    body = text[:cut]
    lines = [line for line in body.splitlines() if not line.lstrip().startswith(">")]
    body = _DEVICE_LINE.sub("", "\n".join(lines))
    body = re.sub(r"\n{3,}", "\n\n", body).strip()
    return body or text.strip()


def message_text(row: dict[str, Any]) -> str:
    """A stored message's text as the models should see it."""
    text = str(row.get("text") or "")
    if row.get("direction") == "inbound" and row.get("channel") == "email":
        text = clean_email_text(text)
    return text.strip()


def _iso(value: Any) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else (str(value) if value else None)


def to_pack_message(row: dict[str, Any]) -> PackMessage:
    return PackMessage(direction=row["direction"], channel=row.get("channel") or "sms", text=message_text(row),
                       at=_iso(row.get("sent_at") or row.get("created_at")), resend=bool(row.get("is_fallback")))


def _cap(message: PackMessage) -> tuple[PackMessage, bool]:
    if len(message.text) <= MAX_MESSAGE_CHARS:
        return message, False
    return message.model_copy(update={"text": message.text[:MAX_MESSAGE_CHARS] + TRIMMED}), True


def select_working_memory(history: list[PackMessage], budget_tokens: int) -> tuple[list[PackMessage], dict[str, int]]:
    """Newest first: keep the last MIN_RECENT messages whatever they cost,
    then older ones while they fit the budget. Returns them oldest first."""
    kept: list[PackMessage] = []
    used = trimmed = 0
    for index, message in enumerate(reversed(history)):
        message, was_trimmed = _cap(message)
        cost = estimate_tokens(message.text)
        if index >= MIN_RECENT and used + cost > budget_tokens:
            break
        kept.append(message)
        used += cost
        trimmed += was_trimmed
    kept.reverse()
    return kept, {"used": used, "trimmed": trimmed}


def profile_layer(profile: dict[str, Any], today: Any = None) -> list[dict[str, Any]]:
    """The slots as the AI steps see them, each with its value in plain words."""
    return [{"label": s["label"], "path": s["path"], "value": s.get("value"),
             "display": display_value(SCHEMA.get(s["path"]), s.get("value"), today),
             "state": s["state"], "source": s.get("source")} for s in profile.get("slots", [])]


def build_pack(
    *,
    now_local: datetime,
    dealer: dict[str, Any],
    customer: dict[str, Any],
    lead_type: str,
    profile: dict[str, Any],
    new_messages: list[PackMessage],
    history: list[PackMessage],
    more_not_loaded: bool,
    conversation: ConversationState,
    campaign: dict[str, Any] | None,
    working_tokens: int,
    summary: str | None = None,
    summary_covers: int = 0,
    summary_behind: bool = False,
    inventory: list[dict[str, Any]] | None = None,
    inventory_query: dict[str, Any] | None = None,
    inventory_checked_at: str | None = None,
) -> ContextPack:
    """`history`: the thread before this turn's new messages, oldest first."""
    working, used = select_working_memory(history, working_tokens)
    new_capped = [_cap(m)[0] for m in new_messages]
    slots = profile_layer(profile, now_local.date())
    pack = ContextPack(
        now={"date": now_local.strftime("%Y-%m-%d"), "weekday": now_local.strftime("%A"),
             "time": now_local.strftime("%H:%M"), "timezone": dealer.get("timezone", "")},
        dealer=dealer,
        customer=customer,
        lead_type=lead_type,
        profile=slots,
        about_customer=about_customer(slots, now_local.date()),
        new_messages=new_capped,
        working_memory=working,
        summary=summary or None,
        conversation=conversation,
        campaign=campaign,
        inventory=inventory or [],
        inventory_query=inventory_query,
        inventory_checked_at=inventory_checked_at,
        budget=PackBudget(working_tokens=working_tokens, working_used=used["used"], loaded=len(history),
                          kept=len(working), dropped=len(history) - len(working), more_not_loaded=more_not_loaded,
                          trimmed_messages=used["trimmed"], summary_behind=summary_behind,
                          summary_covers=summary_covers),
    )
    pack.budget.tokens = {
        "new_messages": sum(estimate_tokens(m.text) for m in pack.new_messages),
        "working_memory": used["used"],
        "profile": estimate_tokens(str(slots)),
        "conversation": estimate_tokens(conversation.model_dump_json()),
        "campaign": estimate_tokens(str(campaign)) if campaign else 0,
        "summary": estimate_tokens(pack.summary or ""),
        "inventory": estimate_tokens(str(pack.inventory)) if pack.inventory else 0,
    }
    return pack
