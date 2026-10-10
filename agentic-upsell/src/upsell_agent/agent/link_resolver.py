"""Which link a reply may carry, decided in code (conversation_7: the AI sent the dealer's homepage, and an
invented "trade-in link", when the customer asked for "a link to look" at the RDX they inquired about).

Extract says what the customer wants a link to (`link_target`: a vehicle, the dealership's website, something
else, or unclear), how sure it is, and which vehicle when it can tell. This module turns that into the URLs the
reply may carry - only ever one of two kinds:

- vehicle: the vehicle's own page on the dealer's site (`page_url`, from the record's `inventoryUrl`)
- website: the dealership's homepage (`store_website` on the dealer record)

Compose never writes a URL: it writes [VEHICLE_LINK] / [WEBSITE_LINK] and `fill_links` puts the real one in.
The guard (guardrails/link_guard.py) then lets through only the URLs of this turn's plan.

Rules:
1. No link request -> no link.
2. The website, asked for plainly -> the homepage (none on record: say the team will send it).
3. A vehicle (named, referred back to, or the one the lead is about) with a page:
   sure (target confidence >= TARGET_CONFIDENCE) -> its page only;
   not sure -> its page first, and the homepage after it, in the same message.
4. That vehicle has no page -> no link at all (never the homepage instead), an honest line, and a promise the
   team will send it (the team is told - agent/turn.py _notify_team_of_promises).
5. No vehicle to point at -> no link: ask which one.
6. Something we hold no link for (a trade-in form, a credit application) -> no link, an honest line.
"""

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from upsell_agent.agent.vehicle_media import wants_link

# At or above: the vehicle's page alone. Below: its page, then the homepage, together.
TARGET_CONFIDENCE = 0.75

VEHICLE_PLACEHOLDER = "[VEHICLE_LINK]"
WEBSITE_PLACEHOLDER = "[WEBSITE_LINK]"
_PLACEHOLDER = re.compile(r"\[\s*(VEHICLE|WEBSITE)_LINK\s*\]", re.IGNORECASE)

# Fixed, true reasons (the model never makes one up).
NO_PAGE_LINE = "I don't have an online page for that one handy right now."
NO_WEBSITE_LINE = "I don't have our website link handy right now."
OTHER_LINE = "I don't have a link for that, but I can help you with it right here."

PlanKind = Literal["none", "vehicle", "vehicle_and_website", "website", "unavailable", "ask_which"]


@dataclass
class LinkPlan:
    kind: PlanKind = "none"
    vin: str | None = None
    description: str | None = None
    vehicle_url: str | None = None
    website_url: str | None = None
    confidence: float = 0.0
    honest_line: str | None = None
    promise: str | None = None
    reasons: list[str] = field(default_factory=list)

    @property
    def urls(self) -> list[str]:
        """The URLs this turn's reply may carry."""
        return [u for u in (self.vehicle_url, self.website_url) if u]

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "urls": self.urls}

    def for_compose(self) -> dict[str, Any] | None:
        """What Compose is told: never a URL, only which placeholder(s) to write."""
        if self.kind == "none":
            return None
        return {"kind": self.kind, "vin": self.vin, "vehicle": self.description,
                "placeholders": [p for p, url in ((VEHICLE_PLACEHOLDER, self.vehicle_url),
                                                  (WEBSITE_PLACEHOLDER, self.website_url)) if url],
                "honest_line": self.honest_line}


def _describe(record: dict[str, Any]) -> str:
    return " ".join(str(record[k]) for k in ("year", "make", "model") if record.get(k)) or "that vehicle"


def resolve_link(extraction: dict[str, Any] | None, *, inventory: list[dict[str, Any]] | None,
                 website: str | None, referred_vin: str | None = None, lead_vin: str | None = None) -> LinkPlan:
    """The link plan for this turn. `inventory`: this turn's stock records (context.inventory). `website`: the
    dealer's homepage. `referred_vin`: the shown vehicle the customer refers back to. `lead_vin`: the vehicle
    the lead is about (agent/vehicle_media.py lead_vehicle_vin)."""
    plan = LinkPlan()
    if not wants_link(extraction):
        return plan
    extraction = extraction or {}
    target = extraction.get("link_target") or "unclear"
    plan.confidence = float(extraction.get("link_target_confidence") or 0.0)
    sure = plan.confidence >= TARGET_CONFIDENCE

    if target == "website" and sure:
        if website:
            plan.kind, plan.website_url = "website", website
            plan.reasons.append("They asked for the dealership's website: the homepage.")
        else:
            plan.kind, plan.honest_line = "unavailable", NO_WEBSITE_LINE
            plan.promise = "The team will send the customer the dealership's website link."
            plan.reasons.append("They asked for the website, but the dealer record has none.")
        return plan
    if target == "other" and sure:
        plan.kind, plan.honest_line = "unavailable", OTHER_LINE
        plan.reasons.append("They asked for a link we don't hold (not a vehicle page or the website): no link.")
        return plan

    by_vin = {r["vin"]: r for r in inventory or [] if r.get("vin")}
    picked = next(((vin, why) for vin, why in ((extraction.get("link_target_vin"), "the vehicle they named"),
                                                (referred_vin, "the vehicle they referred back to"),
                                                (lead_vin, "the vehicle the lead is about"))
                   if vin and vin in by_vin), None)
    if picked is None and len(by_vin) == 1:
        picked = (next(iter(by_vin)), "the only vehicle in this conversation's stock")
    if picked is None:
        plan.kind = "ask_which"
        plan.reasons.append("They asked for a link but no vehicle can be told apart: ask which one, no link.")
        return plan

    vin, why = picked
    record = by_vin[vin]
    plan.vin, plan.description = vin, _describe(record)
    page = str(record.get("page_url") or "").strip()
    if not page:
        plan.kind, plan.honest_line = "unavailable", NO_PAGE_LINE
        plan.promise = f"The team will send the customer the online page for the {plan.description} ({vin})."
        plan.reasons.append(f"{plan.description} ({vin}, {why}) has no inventoryUrl: no link, never the homepage "
                            "in its place; the team is told.")
        return plan
    plan.vehicle_url = page
    if sure and target == "vehicle":
        plan.kind = "vehicle"
        plan.reasons.append(f"Sure they want {why} ({vin}, confidence {plan.confidence:.2f}): its page.")
    elif website:
        plan.kind, plan.website_url = "vehicle_and_website", website
        plan.reasons.append(f"Not sure which link (target {target}, confidence {plan.confidence:.2f}): "
                            f"{why}'s page first, then the homepage.")
    else:
        plan.kind = "vehicle"
        plan.reasons.append(f"Not sure which link, and no homepage on record: {why}'s page ({vin}).")
    return plan


def _append(text: str, addition: str, limit: int | None) -> str:
    joined = f"{text.rstrip()} {addition}".strip()
    return joined if limit is None or len(joined) <= limit else text


def fill_links(draft: dict[str, Any], plan: LinkPlan, *, sms_limit: int | None = None) -> list[str]:
    """Puts the plan's real URLs where Compose wrote the placeholders, in place. A placeholder with no URL in the
    plan is removed. When the plan has a vehicle page and a version carries no link at all, the page is added
    after it (it fits the SMS limit, or the SMS is left as it is). Returns what was done, for the trace."""
    done: list[str] = []
    urls = {"VEHICLE": plan.vehicle_url, "WEBSITE": plan.website_url}
    for name, key in (("SMS", "sms_text"), ("email subject", "email_subject"), ("email", "email_body")):
        text = str(draft.get(key) or "")
        if not text:
            continue
        filled = _PLACEHOLDER.sub(lambda m: urls[m.group(1).upper()] or "", text)
        filled = re.sub(r"[ \t]{2,}", " ", filled).replace(" .", ".").replace(" ,", ",")
        if key != "email_subject" and plan.vehicle_url and plan.vehicle_url not in filled:
            addition = f"Here's the link: {plan.vehicle_url}"
            if plan.website_url and plan.website_url not in filled:
                addition += f" You can also browse everything we have at {plan.website_url}"
            before = filled
            filled = _append(filled, addition, sms_limit if key == "sms_text" else None)
            if filled != before:
                done.append(f"{name}: the vehicle's page added by code (the draft left it out).")
        if filled != text:
            draft[key] = filled
            done.append(f"{name}: links filled in.")
    # The stock-free versions go out only once the vehicle may have sold: no vehicle link in them.
    for key in ("sms_text_no_vehicles", "email_subject_no_vehicles", "email_body_no_vehicles"):
        if draft.get(key):
            draft[key] = re.sub(r"[ \t]{2,}", " ", _PLACEHOLDER.sub("", str(draft[key]))).strip()
    if plan.vin and plan.vehicle_url:
        for key, most in (("sms_vins", 2), ("email_vins", 3)):
            vins = list(draft.get(key) or [])
            if plan.vin not in vins and len(vins) < most:
                draft[key] = [*vins, plan.vin]
    if plan.promise and plan.promise not in (draft.get("promises") or []):
        draft["promises"] = [*(draft.get("promises") or []), plan.promise]
    return done
