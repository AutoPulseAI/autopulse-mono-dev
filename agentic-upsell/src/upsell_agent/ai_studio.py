"""AI Studio, connected (client, 13 Oct 2026: "the back end will go dynamic ... things can be updated, added, deleted").

The super admin edits the AI's settings in the CRM (aidmvcs-be-dev app/admin/ai-studio): every item is versioned in
`ai_config_items` / `ai_config_versions`, and only a PUBLISHED version counts - a draft never reaches a customer.
This module reads the published versions (at most once a minute) and puts them in place of the built-in ones:

- an item whose published content is the built-in content (never edited, or reset to default) changes nothing;
- an item that differs replaces the built-in setting it came from, step by step (one edited touch of a cadence
  changes that touch only);
- an item the super admin added (an agent, a workflow, a cadence touch) is added; deleting it removes it;
- anything missing, unreadable or broken keeps the built-in setting, so an edit can never stop the AI.

The built-in settings are the code's own (devtools/export_ai_config.py exports them as version 1); the safety checks
(FTC introduction, opt-out, texting hours, Guard) apply to edited text exactly as to the built-in text.
"""

import copy
import dataclasses
import logging
import re
import time
from typing import Any

logger = logging.getLogger(__name__)

ITEMS_COLLECTION = "ai_config_items"
VERSIONS_COLLECTION = "ai_config_versions"
TTL_SECONDS = 60.0

_defaults: dict[tuple[str, str], dict[str, Any]] | None = None  # (type, key) -> the built-in content
_pristine: dict[str, Any] = {}  # the code's own settings, before anything was applied
_changed: dict[tuple[str, str], dict[str, Any]] = {}  # published content that differs from the built-in
_names: dict[tuple[str, str], str] = {}
_failed: set[tuple[str, str]] = set()  # published items that couldn't be applied (the built-in stays)
# Rules the dealership added in AI Studio (SMS, Email & Compliance -> "+ New rule"): (rule, applies_to, banned phrases).
CUSTOM_RULES: list[dict[str, Any]] = []  # each item's name in the Studio (an added agent's or workflow's label)
_loaded_at = 0.0


# --- Reading ---------------------------------------------------------------------------------------------------

async def refresh(*, force: bool = False) -> None:
    """Reads the published settings when the last read is over a minute old. Never raises."""
    global _loaded_at
    if not force and time.monotonic() - _loaded_at < TTL_SECONDS:
        return
    _loaded_at = time.monotonic()
    try:
        from upsell_agent.integrations.mongodb import get_db
        db = get_db()
        items = await db[ITEMS_COLLECTION].find(
            {"deleted": {"$ne": True}, "dealer_id": None, "published_version": {"$ne": None}}).to_list(None)
        published: dict[tuple[str, str], dict[str, Any]] = {}
        for item in items:
            version = await db[VERSIONS_COLLECTION].find_one(
                {"item_id": item["_id"], "version": item.get("published_version")})
            if version and isinstance(version.get("content"), dict) and not await _is_built_in(db, version):
                published[(item["type"], item["key"])] = version["content"]
                _names[(item["type"], item["key"])] = str(item.get("name") or item["key"])
        load(published)
        await _mark_applied(db, items)
    except Exception:  # the AI keeps what it has (built-in or the last good read)
        logger.exception("could not read the AI Studio settings")


async def _mark_applied(db: Any, items: list[dict[str, Any]]) -> None:
    """Shown in AI Studio (client, 13 Oct 2026): which published version the AI is using, and since when. An item that
    couldn't be applied isn't marked (the built-in setting is in use)."""
    from upsell_agent import clock
    now = clock.now()
    for item in items:
        if (item["type"], item["key"]) in _failed or item.get("ai_applied_version") == item.get("published_version"):
            continue
        await db[ITEMS_COLLECTION].update_one({"_id": item["_id"]}, {"$set": {
            "ai_applied_version": item.get("published_version"), "ai_applied_at": now}})


_BUILT_IN_NOTES = ("Built-in setting", "Reset to the AutoPulse default")


async def _is_built_in(db: Any, version: dict[str, Any]) -> bool:
    """The published version is the built-in setting itself (seeded, reset, or reverted to one of those): the code's
    current built-in applies, never an older copy of it."""
    for _ in range(20):
        if str(version.get("note") or "").startswith(_BUILT_IN_NOTES):
            return True
        if not version.get("reverted_from"):
            return False
        version = await db[VERSIONS_COLLECTION].find_one(
            {"item_id": version["item_id"], "version": version["reverted_from"]}) or {}
    return False


def load(published: dict[tuple[str, str], dict[str, Any]]) -> None:
    """Puts these published settings in place (and puts back the built-in ones nobody changes any more)."""
    global _changed
    _snapshot()
    defaults = _built_in()
    changed = {k: c for k, c in published.items() if not _same(c, defaults.get(k))}
    if changed == _changed:
        return
    _restore()
    _changed = changed
    CUSTOM_RULES.clear()
    _failed.clear()
    for (kind, key), content in sorted(changed.items()):
        try:
            _APPLY.get(kind, lambda *_: None)(key, content, defaults.get((kind, key)))
        except Exception:  # one broken item never takes the others down
            _failed.add((kind, key))
            logger.exception("AI Studio item %s/%s could not be applied; the built-in setting stays", kind, key)
    try:
        _apply_custom_banned()
    except Exception:
        logger.exception("the banned phrases of the dealership's own rules could not be applied")
    try:
        _build_schedule()
    except Exception:
        logger.exception("the sales cadence timing set in AI Studio could not be applied; the built-in one stays")
        _by_name()["cadence"].SCHEDULE = None
    if changed:
        logger.info("AI Studio: %d edited setting(s) in use: %s", len(changed), sorted(changed))


def reset() -> None:
    """Back to the code's own settings (tests)."""
    global _changed, _loaded_at
    if _pristine:
        _restore()
    CUSTOM_RULES.clear()
    _changed, _loaded_at = {}, 0.0


def _same(a: Any, b: Any) -> bool:
    return b is not None and _plain(a) == _plain(b)


def _plain(value: Any) -> Any:
    """Content as compared: what the editor adds without changing anything (empty fields, keys order) is ignored."""
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items() if v not in (None, "", [], {})}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def _built_in() -> dict[tuple[str, str], dict[str, Any]]:
    global _defaults
    if _defaults is None:
        from upsell_agent.devtools.export_ai_config import export
        _defaults = {(i["type"], i["key"]): i["content"] for i in export()["items"]}
    return _defaults


# --- What the code asks ----------------------------------------------------------------------------------------

def content(kind: str, key: str) -> dict[str, Any] | None:
    """The published content of an edited (or added) item, or None: the built-in setting applies."""
    return _changed.get((kind, key))


def step_message(kind: str, key: str, step_id: str) -> dict[str, Any] | None:
    """An edited step's message (a cadence touch, by its id), or None when that step wasn't changed."""
    edited = content(kind, key)
    if not edited:
        return None
    built_in = {s.get("id"): s for s in (_built_in().get((kind, key)) or {}).get("steps") or []}
    for step in edited.get("steps") or []:
        if step.get("id") == step_id:
            message = step.get("message") or {}
            return None if _same(message, (built_in.get(step_id) or {}).get("message")) else message
    return None


def message(kind: str, key: str) -> dict[str, Any] | None:
    """An edited single message (the Messages section), or None."""
    edited = content(kind, key)
    return (edited or {}).get("message") or None


def dealer_rules() -> str:
    """The dealership's own rules, as the lines added to the writer's instructions."""
    lines = []
    for r in CUSTOM_RULES:
        where = "" if set(r["applies_to"]) == {"text", "email"} else (
            " (text messages only)" if r["applies_to"] == ["text"] else " (emails only)")
        if r["rule"]:
            lines.append(f"- {r['rule']}{where}")
        if r["banned"]:
            lines.append(f"- Never use these words or phrases{where}: " + "; ".join(f'"{p}"' for p in r["banned"]))
    return ("\n\nTHE DEALERSHIP'S OWN RULES (set by the dealership; always follow them, after the rules above):\n"
            + "\n".join(lines)) if lines else ""


def _apply_custom_banned() -> None:
    """The banned phrases of the dealership's own rules join the guard's list (agent/nodes/guard.py _TEAM)."""
    words = [p for r in CUSTOM_RULES for p in r["banned"]]
    if not words:
        return
    gd = _by_name()["guard"]
    extra = words_to_pattern(words)
    gd._TEAM = re.compile(f"(?:{gd._TEAM.pattern})|{extra}", re.IGNORECASE)


def compose_prompt() -> str | None:
    edited = content("prompts", "compose")
    text = (edited or {}).get("text")
    return text.strip() if isinstance(text, str) and len(text.strip()) > 200 else None


_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


def fill(text: str | None, values: dict[str, Any]) -> str:
    """`text` with its {placeholders} filled; one we have no value for is left out with its space."""
    out = _PLACEHOLDER.sub(lambda m: str(values.get(m.group(1)) or ""), str(text or ""))
    out = re.sub(r"\bthis is\s*,\s*", "this is ", out)  # no agent name: "this is Victory Cars' AI Sales Manager"
    out = re.sub(r"(\w)s's\b", r"\1s'", out)
    out = re.sub(r"\s*,\s*,", ",", out)
    out = re.sub(r"[ \t]+([,.!?])", r"\1", out)
    out = re.sub(r"\b(Hi|Hello|Thanks|Thank you),\s*([!.?])", r"\1\2", out)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def fixed_text(msg: dict[str, Any] | None) -> str | None:
    """The text code places for a message block: the fixed text (or the opening), else its backup message."""
    if not msg:
        return None
    if msg.get("mode") in ("fixed", "fixed_opening_ai") and str(msg.get("text") or "").strip():
        return msg["text"]
    return msg.get("fallback") or None


def render(msg: dict[str, Any] | None, values: dict[str, Any], built: dict[str, str] | None = None
           ) -> dict[str, str] | None:
    """{sms_text, email_subject, email_body} for an edited message block, keeping `built`'s other keys; None when
    there is nothing code can send word for word (an "AI writes it" block without a backup message)."""
    text = fixed_text(msg)
    if not text:
        return None
    sms = fill(text, values)
    if not sms:
        return None
    built = built or {}
    out = dict(built)
    out["sms_text"] = sms
    # The email: its own text when written, else the message with the built-in email's sign-off.
    sign_off = ""
    if built.get("sms_text") and built.get("sms_text") in str(built.get("email_body") or ""):
        sign_off = str(built["email_body"]).split(built["sms_text"], 1)[1]
    out["email_body"] = fill(msg.get("email_text"), values) or sms + sign_off
    out["email_subject"] = fill(msg.get("email_subject"), values) or built.get("email_subject") or ""
    return out


def instruction(msg: dict[str, Any] | None) -> str | None:
    if not msg or msg.get("mode") == "fixed":
        return None
    return str(msg.get("instruction") or "").strip() or None


def words_to_pattern(words: list[str]) -> str | None:
    """The word chips as a match pattern: "approv…" matches approve, approved, approval."""
    parts = []
    for word in words or []:
        word = str(word).strip().lower()
        if not word:
            continue
        piece = re.escape(word).replace("…", r"\w*").replace(r"\.\.\.", r"\w*")
        parts.append(re.sub(r"(\\ )+", r"\\s+", piece))
    return r"\b(" + "|".join(parts) + r")\b" if parts else None


def _pattern(content_: dict[str, Any], words_key: str, pattern_key: str) -> str | None:
    """The editor's word chips (`words_key`; a trigger's are "phrases") when it saved them, else the built-in pattern."""
    for key in (words_key, "phrases"):
        if isinstance(content_.get(key), list) and content_[key]:
            return words_to_pattern(content_[key])
    return content_.get(pattern_key) or None


# --- Snapshot / restore of the code's own settings ---------------------------------------------------------------

def _modules():
    from upsell_agent.agent import (
        buyers_order,
        cadence,
        cannot_supply,
        crm_status,
        escalation,
        lead_bucket,
        lifecycle,
        specialists,
    )
    from upsell_agent.compliance import origin
    return buyers_order, cadence, cannot_supply, crm_status, escalation, lead_bucket, lifecycle, specialists, origin


_ATTRS = {
    "specialists": ("SPECIALISTS", "_PATTERNS", "_COMPILED", "_BUCKET_DEFAULT"),
    "lead_bucket": ("BUCKET_SOURCES", "WORD_TRACKS"),
    "origin": ("INBOUND_SOURCES", "DMS_SOURCES"),
    "cannot_supply": ("_PATTERNS", "_COMPILED", "_REPLIES", "ESCALATES", "CUSTOM_LABELS"),
    "buyers_order": ("ASKS", "START", "START_STEP", "_TEXT", "ESCALATE_AT", "FLOWS", "ACTIONS"),
    "cadence": ("DAY_THEMES", "NURTURE_THEMES", "DEEPER_THEMES", "EXTENDED_THEMES", "BY_ID", "SCHEDULE", "LAST_DAY"),
    "escalation": ("MANAGER_ESCALATIONS",),
    "lifecycle": ("STAFF_STATUS_EVENTS", "OPPORTUNITY_DAYS"),
    "sold_pending": ("STUDIO_DAYS",),
    "owner_touches": ("OWNER_TOUCH_DAYS",),
    "appointment": ("DETAILS_AFTER", "NO_SHOW_AFTER", "NO_SHOW_FOLLOWUP_AFTER"),
    "engine": ("REPLY_WINDOW", "TRANSACTIONAL_WINDOW", "MARKETING_WINDOW", "MARKETING_SMS_CAP", "CAP_PERIOD",
               "DND_STATUSES", "STOP_ENDS_ALL_FOLLOWUPS"),
    "state_hours": ("STATE_RULES",),
    "opt_out": ("STOP_WORDS", "_STOP_TOKENS", "START_WORDS", "NL_CONFIRMATION", "_PHRASES", "INQUIRY_CONFIRMATION",
                "VEHICLE_UPDATES_QUESTION", "VEHICLE_UPDATES_YES", "INQUIRY_ONLY", "STOP_EVERYTHING_PHRASES",
                "STOP_SENTENCE_IN_MESSAGE"),
    "vehicle_media": ("PHOTO_ON_FIRST_MESSAGE", "PHOTOS_ON_REQUEST"),
    "short_links": ("ENABLED",),
    "presend": ("CHECKS",),
    "link_resolver": ("SHAREABLE",),
    "decide": ("BUSY_RULE", "BUSY_PHRASES", "NAME_QUESTION", "EMAIL_QUESTIONS", "PHONE_QUESTIONS", "ASK_PHONE"),
    "text_consent": ("INVITE", "CONFIRMATION"),
    "consent": ("FIRST_CHANNEL", "AT_NIGHT", "_PLACEHOLDER_EMAIL"),
    "draft_guard": ("SMS_MAX", "TOUCH1_SMS_MAX", "SMS_MAX_VEHICLES", "EMAIL_MAX_VEHICLES"),
    "guard": ("_TEAM", "HANDOFF_AFTER_FAILED_DRAFTS"),
    "policy": ("MAX_ASKS_PER_MESSAGE",),
    "templates": ("FIRST_REPLY", "HOLDING_REPLIES", "CONTINUE_NOTED", "CONTINUE_VARIANTS"),
    "crm_status": ("CRM_STATUS_FOR_STAGE", "CRM_STATUS_FOR_EVENT"),
    "staff_view": ("ACTION_KINDS",),
    # AI Studio > Compliance > Safeguards (the user, 26 Oct 2026: every rule set in code is shown and editable here).
    "turn": ("SECOND_FORM_IS_CONTACT",),
    "handlers": ("DUPLICATE_STAYS_QUIET",),
    "safety_net": ("ENABLED",),
    "studio_cadences": ("WAIT_WHEN_THEY_WILL_REACH_OUT",),
    "followups": ("FIRE_CONCURRENCY", "FIRE_BATCH_LIMIT"),
    "stock_match": ("ENABLED", "FROM_SEARCH", "FROM_MATCH"),
    "search_stock": ("AWD_ENABLED", "AWD_STRETCH_PERCENT", "AWD_SHOWN"),
    "lead_brief": ("SUBJECT_IDEAS", "SUBJECT_RULE"),
}


# AI Studio > Compliance > Safeguards: field -> (module, attribute). Betsy's published value always wins.
SAFEGUARD_SWITCHES = {
    "stop_ends_all_followups": ("engine", "STOP_ENDS_ALL_FOLLOWUPS"),
    "stop_sentence_in_a_longer_message": ("opt_out", "STOP_SENTENCE_IN_MESSAGE"),
    "second_lead_form_counts_as_contacted": ("turn", "SECOND_FORM_IS_CONTACT"),
    "one_conversation_per_customer": ("handlers", "DUPLICATE_STAYS_QUIET"),
    "safety_net_every_lead_has_a_next_step": ("safety_net", "ENABLED"),
    "no_still_with_me_after_ill_reach_out": ("studio_cadences", "WAIT_WHEN_THEY_WILL_REACH_OUT"),
    "hybrid_stock_search": ("stock_match", "ENABLED"),
    "all_wheel_drive_search": ("search_stock", "AWD_ENABLED"),
}
SAFEGUARD_NUMBERS = {  # field -> (module, attribute, lowest, highest)
    "followups_sent_at_once": ("followups", "FIRE_CONCURRENCY", 1, 10),
    "followups_per_minute": ("followups", "FIRE_BATCH_LIMIT", 10, 200),
    "cars_from_current_search": ("stock_match", "FROM_SEARCH", 1, 5),
    "cars_from_new_search": ("stock_match", "FROM_MATCH", 0, 5),
    "all_wheel_drive_budget_stretch_percent": ("search_stock", "AWD_STRETCH_PERCENT", 0, 100),
    "all_wheel_drive_cars_added": ("search_stock", "AWD_SHOWN", 0, 5),
}


def _by_name() -> dict[str, Any]:
    b, cad, cs, crm, esc, lb, lc, sp, org = _modules()
    from upsell_agent.agent import appointment, owner_touches, sold_pending, templates
    from upsell_agent.agent.nodes import guard
    from upsell_agent.channels import consent
    from upsell_agent.compliance import engine, opt_out, state_hours, text_consent
    from upsell_agent.guardrails import draft_guard
    return {"specialists": sp, "lead_bucket": lb, "origin": org, "cannot_supply": cs, "buyers_order": b,
            "cadence": cad, "escalation": esc, "lifecycle": lc, "crm_status": crm, "sold_pending": sold_pending,
            "owner_touches": owner_touches, "appointment": appointment, "engine": engine,
            "state_hours": state_hours, "opt_out": opt_out, "text_consent": text_consent, "consent": consent,
            "draft_guard": draft_guard, "guard": guard, "templates": templates, "staff_view": _staff_view_module(),
            "policy": _policy_module(), **_media_modules()}


def _media_modules() -> dict[str, Any]:
    from upsell_agent.agent import link_resolver, short_links, vehicle_media
    from upsell_agent.agent.nodes import decide
    from upsell_agent.channels import presend
    from upsell_agent.agent import turn
    from upsell_agent.events import handlers
    from upsell_agent.scheduler import followups, safety_net, studio_cadences
    from upsell_agent.agent import lead_brief
    from upsell_agent.agent.nodes import search_stock
    from upsell_agent.tools import stock_match
    return {"vehicle_media": vehicle_media, "short_links": short_links, "link_resolver": link_resolver,
            "decide": decide, "presend": presend, "turn": turn, "handlers": handlers, "safety_net": safety_net,
            "studio_cadences": studio_cadences, "followups": followups, "stock_match": stock_match,
            "search_stock": search_stock, "lead_brief": lead_brief}


def _policy_module():
    from upsell_agent.slots import policy
    return policy


def _staff_view_module():
    from upsell_agent.api import staff_view
    return staff_view


def _snapshot() -> None:
    if _pristine:
        return
    _built_in()  # the defaults are read from the code before anything is changed
    for name, module in _by_name().items():
        for attr in _ATTRS[name]:
            _pristine[(name, attr)] = copy.copy(getattr(module, attr))


def _restore() -> None:
    """Every setting back to the code's own, in place (lists and dicts other modules imported by name included)."""
    modules = _by_name()
    for (name, attr), value in _pristine.items():
        current = getattr(modules[name], attr)
        if isinstance(current, list) and isinstance(value, list):
            current[:] = value
        elif isinstance(current, dict) and isinstance(value, dict):
            current.clear()
            current.update(value)
        else:
            # A fresh copy: a set edited in place later must never change the built-in kept here.
            setattr(modules[name], attr, copy.copy(value))


# --- Applying each kind of item -----------------------------------------------------------------------------------

def _apply_agent(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    sp = _by_name()["specialists"]
    playbook = str(c.get("playbook") or "").strip()
    examples = [e.strip() for e in c.get("examples") or [] if str(e).strip()]
    if examples:
        playbook += "\nExamples of a great reply:\n" + "\n---\n".join(examples)
    current = sp.SPECIALISTS.get(key)
    if current:
        sp.SPECIALISTS[key] = dataclasses.replace(current, playbook=playbook or current.playbook,
                                                  never=str(c.get("never") or "").strip() or current.never)
    else:
        sp.SPECIALISTS[key] = sp.Specialist(key, str(c.get("name") or _names.get(("agents", key))
                                                     or key.replace("_", " ").title()),
                                            playbook, str(c.get("never") or "").strip())
    pattern = _pattern(c, "keywords", "steps_in_when")
    if built_in is not None and pattern == built_in.get("steps_in_when"):
        return
    others = [(sid, p) for sid, p in sp._PATTERNS if sid != key]
    if pattern and pattern != "default (everything else)":
        re.compile(pattern)
        # An added agent is checked first (its words are the most specific); an edited one keeps its place.
        place = next((i for i, (sid, _) in enumerate(sp._PATTERNS) if sid == key), 0)
        others.insert(min(place, len(others)), (key, pattern))
    sp._PATTERNS = tuple(others)
    sp._COMPILED = tuple((sid, re.compile(p, re.IGNORECASE)) for sid, p in sp._PATTERNS)


def _apply_bucket(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    lb, sp = _by_name()["lead_bucket"], _by_name()["specialists"]
    pattern = _pattern(c, "sources", "source_pattern")
    if pattern:
        re.compile(pattern)
        rows = [(b, pattern if b == key else p) for b, p in lb.BUCKET_SOURCES]
        if key not in {b for b, _ in rows}:
            rows.append((key, pattern))
        lb.BUCKET_SOURCES[:] = rows
    if c.get("word_track"):
        lb.WORD_TRACKS[key] = c["word_track"]
    if c.get("agent") in sp.SPECIALISTS:
        if c["agent"] == sp.SALES:
            sp._BUCKET_DEFAULT.pop(key, None)
        else:
            sp._BUCKET_DEFAULT[key] = c["agent"]


def _apply_sources(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    org = _by_name()["origin"]
    pattern = _pattern(c, "sources", "pattern")
    if not pattern:
        return
    compiled = re.compile(pattern, re.IGNORECASE)
    if key == "inbound_sources":
        org.INBOUND_SOURCES = compiled
    elif key == "outbound_sources":
        org.DMS_SOURCES = compiled


def _studio_to_script(text: str, topic: str = "") -> str:
    """A workflow message as the script engines write it. Only Betsy's payment answer's {vehicle_link} is the payment
    calculator sentence; anywhere else it is the vehicle's own page link (client, 20 Oct 2026, Joel Clymer: her CARFAX
    answer "Here is a link to the vehicle..." went out with no link)."""
    text = str(text or "")
    if topic == "payment":
        return text.replace(" {vehicle_link}", "{calculator}").replace("{vehicle_link}", "{calculator}")
    return text


def _escalates(node: dict[str, Any]) -> bool:
    return "dealership_action_required" in (node.get("also") or []) or any(
        (b.get("then") or {}).get("action") == "escalate" for b in node.get("branches") or [])


def _apply_workflow(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    mods = _by_name()
    cs, bo = mods["cannot_supply"], mods["buyers_order"]
    tree = c.get("tree") or {}
    trigger = _pattern(c.get("trigger") or {}, "words", "pattern")
    if trigger:
        re.compile(trigger)
    if key == "buyers_order":
        start, start_step, text, escalate_at = _flow(tree, prefix="", actions=bo.ACTIONS)
        if start:
            bo.START = start
            bo._TEXT.clear()
            bo._TEXT.update(text)
            bo.ESCALATE_AT = frozenset(escalate_at)
            bo.START_STEP = start_step
        if trigger:
            bo.ASKS = re.compile(trigger, re.IGNORECASE)
        return
    topic = key.removeprefix("cannot_supply_")
    built_topics = {t for t, _ in _pristine[("cannot_supply", "_PATTERNS")]}
    # A tree that waits for a yes / no (to send a next message, set a status, create a call task...) runs step by step.
    nested = any((b.get("when") or {}).get("value") in ("yes", "no") for b in tree.get("branches") or [])
    if topic in built_topics or not nested:
        # A one-message answer (Betsy's can't-supply scripts, or one added like them): code places it, and offers
        # two open times when it has {times}.
        if topic not in built_topics:
            topic = f"studio_{key}"
            cs.CUSTOM_LABELS[topic] = str(c.get("name") or _names.get(("workflows", key)) or key)
        text = fixed_text(tree.get("message") or {})
        if text:
            cs._REPLIES[topic] = _studio_to_script(text, topic)
        patterns = [(t, p) for t, p in cs._PATTERNS if t != topic]
        pattern = trigger or dict(cs._PATTERNS).get(topic)
        if pattern:
            place = next((i for i, (t, _) in enumerate(cs._PATTERNS) if t == topic), 0)
            patterns.insert(min(place, len(patterns)), (topic, pattern))
        cs._PATTERNS = tuple(patterns)
        cs._COMPILED = tuple((t, re.compile(p, re.IGNORECASE)) for t, p in cs._PATTERNS)
        cs.ESCALATES = frozenset({*(t for t in cs.ESCALATES if t != topic), *([topic] if _escalates(tree) else [])})
        return
    # A workflow with yes / no steps, added in the Studio: it runs like the buyer's order.
    if not trigger:
        return
    start, start_step, text, escalate_at = _flow(tree, prefix=f"{key}:", actions=bo.ACTIONS)
    if start:
        bo.FLOWS.append({"key": key, "asks": re.compile(trigger, re.IGNORECASE), "start": start,
                         "start_step": start_step})
        bo._TEXT.update(text)
        bo.ESCALATE_AT = frozenset({*bo.ESCALATE_AT, *escalate_at})


def _flow(tree: dict[str, Any], *, prefix: str, actions: dict | None = None
          ) -> tuple[str | None, str | None, dict, set]:
    """A yes / no tree as (first message, its step, {(step, answer): (reply, next step)}, the escalating answers).
    A step whose answer leads to another question names that question's step; one that ends, None."""
    text: dict[tuple[str, str], tuple[str, str | None]] = {}
    escalate_at: set[tuple[str, str]] = set()

    def asks(node: dict[str, Any]) -> bool:
        return any((b.get("when") or {}).get("value") in ("yes", "no") and (b.get("then") or {}).get("action") == "ask"
                   for b in node.get("branches") or [])

    def walk(node: dict[str, Any]) -> None:
        step = prefix + str(node.get("id") or "start")
        for branch in node.get("branches") or []:
            answer, then = (branch.get("when") or {}).get("value"), branch.get("then") or {}
            if answer in ("yes", "no") and then.get("action") in ("set_status", "call_task", "escalate", "end"):
                # An end step: what the answer does, and the AI carries the conversation on (no reply of its own).
                text[(step, answer)] = ("", None)
                if actions is not None and then["action"] != "end":
                    actions[(step, answer)] = {
                        "set_status": then.get("status") if then["action"] == "set_status" else None,
                        "call_task": then["action"] == "call_task", "escalate": then["action"] == "escalate"}
                continue
            if answer not in ("yes", "no") or then.get("action") != "ask":
                continue
            child = then.get("node") or {}
            reply = fixed_text(child.get("message") or {})
            if not reply:
                continue
            text[(step, answer)] = (_link(reply), prefix + str(child.get("id")) if asks(child) else None)
            if _escalates(child):
                escalate_at.add((step, answer))
            walk(child)

    start = fixed_text(tree.get("message") or {})
    if not start:
        return None, None, {}, set()
    walk(tree)
    return _link(start), prefix + str(tree.get("id") or "start"), text, escalate_at


def _link(text: str) -> str:
    return text.replace(" Here is a link: {credit_app_link}", "{link}").replace(": {credit_app_link}", ":{link}") \
        .replace(" {credit_app_link}", "{link}").replace("{credit_app_link}", "{link}")


def _apply_cadence(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    cad = _by_name()["cadence"]
    if key == "specific_followup":
        # Client, 21 Oct 2026: "Contact Made - Specific Follow-Up" in AI Studio - its message is read where it's sent
        # (agent/nodes/decide.py); the default time and the no-reply window are set here.
        from upsell_agent.agent.nodes import decide as _decide
        from upsell_agent.scheduler import followups as _fu
        steps = {st.get("id"): st for st in c.get("steps") or []}
        at = str(((steps.get("check_back") or {}).get("wait") or {}).get("at") or "").strip()
        if m := re.fullmatch(r"(\d{1,2}):(\d{2})\s*([AaPp][Mm])?", at):
            hour = int(m.group(1)) % 12 + (12 if (m.group(3) or "").lower() == "pm" else 0) if m.group(3) \
                else int(m.group(1))
            if hour < 24 and int(m.group(2)) < 60:
                _decide.NEXT_ACTION_DEFAULT_TIME = f"{hour:02d}:{m.group(2)}"
        wait = (steps.get("no_reply") or {}).get("wait") or {}
        if wait.get("amount"):
            _fu.NEXT_ACTION_REPLY_WINDOW = _span(wait)
        return
    if key == "unsold":
        return  # its message is read where the first touch after an Unsold visit is written (agent/nodes/decide.py)
    if key in ("sold_pending", "owner_lifecycle", "appointment"):
        _apply_timing(key, c)  # their texts are placed where they're written (step_message)
        return
    if key not in ("sales_days_1_7", "sales_days_8_30", "sales_days_31_90"):
        return  # an added cadence: scheduler/studio_cadences.py runs it
    pristine_by_id = _pristine[("cadence", "BY_ID")]

    def theme(step: dict[str, Any]) -> Any:
        base = cad.BY_ID.get(step.get("id")) or pristine_by_id.get(step.get("id"))
        message_ = step.get("message") or {}
        said = instruction(message_) or (f'Send exactly this message: "{message_.get("text")}"'
                                         if message_.get("mode") == "fixed" and message_.get("text") else None)
        if base:
            return dataclasses.replace(base, label=step.get("label") or base.label,
                                       instruction=said or base.instruction)
        return cad.Theme(str(step.get("id")), str(step.get("label") or "Touch"), said or "", extended=True)

    steps = [s for s in c.get("steps") or [] if s.get("id") not in ("touch1", cad.NAME_NUDGE.id)]
    themes = [theme(s) for s in steps if (s.get("message") or {})]
    themes = [t for t in themes if t.instruction]
    if key == "sales_days_1_7":
        pristine = _pristine[("cadence", "DAY_THEMES")]
        # Days 2-7 go out on fixed days: one theme each, the built-in one where a day was removed.
        cad.DAY_THEMES[:] = (themes + pristine[len(themes):])[:len(pristine)]
        cad.BY_ID.update({t.id: t for t in themes})  # added touches too (the timing places them)
    elif themes:
        (cad.NURTURE_THEMES if key == "sales_days_8_30" else cad.DEEPER_THEMES)[:] = themes
    cad.EXTENDED_THEMES[:] = list(dict.fromkeys([*cad.NURTURE_THEMES, *cad.DEEPER_THEMES]))
    cad.BY_ID.update({t.id: t for t in (*cad.DAY_THEMES, *cad.EXTENDED_THEMES)})


def _span(wait: dict[str, Any]) -> "Any":
    """A wait as a length of time (months and years as calendar ones, from a fixed date)."""
    from datetime import UTC, datetime

    from upsell_agent.agent import timing
    start = datetime(2026, 1, 1, tzinfo=UTC)
    return timing.add(start, float(wait.get("amount") or 0), wait.get("unit")) - start


def _apply_timing(key: str, c: dict[str, Any]) -> None:
    mods = _by_name()
    waits = {s.get("id"): s.get("wait") for s in c.get("steps") or [] if (s.get("wait") or {}).get("amount")}
    if key == "sold_pending":
        days, total = [], 0
        for step in c.get("steps") or []:
            wait = step.get("wait") or {}
            if not wait.get("amount"):
                continue
            span = _span(wait).days
            total = span if wait.get("after") == "start" else total + span
            days.append(max(total, (days[-1] + 1) if days else 0))
        mods["sold_pending"].STUDIO_DAYS = days or None
    elif key == "owner_lifecycle":
        owner = mods["owner_touches"]
        owner.OWNER_TOUCH_DAYS.update({t: _span(w).days for t, w in waits.items() if t in owner.OWNER_TOUCH_DAYS})
    elif key == "appointment":
        appt = mods["appointment"]
        for step_id, attr in ((appt.STEP_DETAILS, "DETAILS_AFTER"), (appt.STEP_NO_SHOW_CHECK, "NO_SHOW_AFTER"),
                              (appt.STEP_NO_SHOW_FOLLOWUP, "NO_SHOW_FOLLOWUP_AFTER")):
            if step_id in waits:
                setattr(appt, attr, _span(waits[step_id]))


SALES_CADENCES = ("sales_days_1_7", "sales_days_8_30", "sales_days_31_90")


def _default_wait(step: dict[str, Any], index: int) -> dict[str, Any]:
    """A touch saved before timing could be set: the client's own schedule."""
    if index == 0:
        return {"amount": 0, "unit": "minutes", "after": "start"}
    if step.get("id") == "name_nudge":
        return {"amount": 3, "unit": "hours", "after": "previous"}
    day = step.get("day") if isinstance(step.get("day"), int) else index + 1
    return {"amount": max(day - 1, 0), "unit": "days", "after": "start", "at": "10:00"}


def _build_schedule() -> None:
    """The sales cadence's timing as set in AI Studio (agent/cadence.py SCHEDULE); None while nobody changed any of
    the three sales cadences, so the client's own schedule runs exactly as before."""
    mods = _by_name()
    cad, lc = mods["cadence"], mods["lifecycle"]
    if not any(("cadences", k) in _changed for k in SALES_CADENCES):
        return
    defaults = _built_in()
    first, nurture, deeper = (_changed.get(("cadences", k)) or defaults[("cadences", k)] for k in SALES_CADENCES)
    steps: list[dict[str, Any] | None] = []
    nudge = None
    for i, step in enumerate(first.get("steps") or []):
        wait = step.get("wait") or _default_wait(step, i)
        channels = [c for c in step.get("channels") or [] if c in ("sms", "email", "call_task")] or None
        if step.get("id") == "touch1":
            steps.insert(0, {"theme": None, "wait": wait, "channels": channels})
        elif step.get("id") == cad.NAME_NUDGE.id:
            nudge = {"theme": cad.NAME_NUDGE, "wait": wait, "channels": channels}
        elif (theme := cad.BY_ID.get(step.get("id"))) is not None:
            steps.append({"theme": theme, "wait": wait, "channels": channels})
    if not steps or steps[0].get("theme") is not None:
        steps.insert(0, {"theme": None, "wait": {"amount": 0, "unit": "minutes"}, "channels": None})
    steps.insert(1, nudge)
    phases = []
    for content_, themes in ((nurture, list(cad.NURTURE_THEMES)), (deeper, list(cad.DEEPER_THEMES))):
        repeat = content_.get("repeat") or {}
        if repeat.get("every"):
            phases.append({**repeat, "themes": themes})
    cad.SCHEDULE = {"steps": steps, "phases": phases}
    closes = deeper.get("closes_after") or {}
    if closes.get("amount"):
        from datetime import UTC, datetime

        from upsell_agent.agent import timing
        start = datetime(2026, 1, 1, tzinfo=UTC)
        days = max(1, (timing.add(start, float(closes["amount"]), closes.get("unit")) - start).days)
        lc.OPPORTUNITY_DAYS, cad.LAST_DAY = days + 1, days


def _apply_status_rules(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    mods = _by_name()
    if key == "escalations" and isinstance(c.get("rules"), list):
        mods["escalation"].MANAGER_ESCALATIONS = tuple(
            (str(r.get("reason_starts_with")), str(r.get("why") or "")) for r in c["rules"]
            if str(r.get("reason_starts_with") or "").strip())
    elif key == "status_workflows" and isinstance(c.get("map"), dict):
        mods["lifecycle"].STAFF_STATUS_EVENTS.update({k: v for k, v in c["map"].items() if v})
    elif key == "contact_questions":
        decide = mods["decide"]
        if str(c.get("name_question") or "").strip():
            decide.NAME_QUESTION = str(c["name_question"]).strip()
        for field, attr in (("email_questions", "EMAIL_QUESTIONS"), ("phone_questions", "PHONE_QUESTIONS")):
            if isinstance(c.get(field), list) and [q for q in c[field] if str(q).strip()]:
                setattr(decide, attr, tuple(str(q).strip() for q in c[field] if str(q).strip()))
        if isinstance(c.get("ask_for_a_phone_when_missing"), bool):
            decide.ASK_PHONE = c["ask_for_a_phone_when_missing"]
    elif key == "email_subjects" and isinstance(c.get("by_intent"), dict):
        from upsell_agent.agent import lead_brief
        lead_brief.SUBJECT_IDEAS = {**lead_brief.SUBJECT_IDEAS, **{
            str(k): [str(x) for x in v if str(x).strip()] for k, v in c["by_intent"].items() if isinstance(v, list)}}
        if str(c.get("rule") or "").strip():
            lead_brief.SUBJECT_RULE = str(c["rule"])
    elif key == "alert_kinds" and isinstance(c.get("counts"), list):
        from upsell_agent.api import staff_view
        # A kind added after the list was saved can't have been unticked: it counts as the code says (e.g.
        # person_requested, 22 Oct 2026). Kinds the saved list knew keep the saved choice.
        known = set(c.get("kinds") or {}) or set(staff_view.ALERT_KINDS) - staff_view.KINDS_ADDED_LATER
        added = {k for k in staff_view.ACTION_KINDS if k not in known}
        staff_view.ACTION_KINDS = frozenset({str(k) for k in c["counts"]} | added)
    elif key == "ai_statuses":
        if isinstance(c.get("stages"), dict):
            mods["crm_status"].CRM_STATUS_FOR_STAGE.update({k: v for k, v in c["stages"].items() if v})
        if isinstance(c.get("closings"), dict):
            mods["crm_status"].CRM_STATUS_FOR_EVENT.update({k: v for k, v in c["closings"].items() if v})


def _apply_message(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    """An added message is sent when the customer says one of its words (like a one-message workflow); the built-in
    ones are read where they're used (message())."""
    if built_in is not None:
        _apply_template_message(key, c)
        return
    send_when = c.get("send_when") or {}
    if not (send_when.get("phrases") or send_when.get("words")):
        return
    _apply_workflow(f"message_{key}", {"name": _names.get(("messages", key)), "trigger": send_when,
                                       "tree": {"id": "answer", "message": c.get("message") or {}, "branches": [
                                           {"when": {"value": "picks_a_time"}, "then": {"action": "book"}}]}},
                    None)


def _to_template_text(text: str | None) -> str:
    return str(text or "").replace("{first_name}", "{name}")


def _apply_template_message(key: str, c: dict[str, Any]) -> None:
    """The fixed texts the AI sends without writing them (agent/templates.py, compliance/opt_out.py)."""
    mods = _by_name()
    tpl, oo = mods["templates"], mods["opt_out"]
    msg = c.get("message") or {}
    text = fixed_text(msg)
    if not text:
        return
    if key.startswith(("first_reply_", "holding_")):
        table = tpl.FIRST_REPLY if key.startswith("first_reply_") else tpl.HOLDING_REPLIES
        name = key.removeprefix("first_reply_").removeprefix("holding_")
        slot = next((k for k in table if getattr(k, "value", k) == name), None)
        if slot is None:
            return
        old = table[slot]
        table[slot] = type(old)(sms=_to_template_text(text),
                                email_subject=_to_template_text(msg.get("email_subject")) or old.email_subject,
                                email_body=_to_template_text(msg.get("email_text"))
                                or "Hi {name},\n\n" + _to_template_text(text) + "\n\nThank you")
    elif key == "continue_noted":
        tpl.CONTINUE_NOTED = _to_template_text(text)
    elif key.startswith("continue_variant_"):
        i = int(key.rsplit("_", 1)[1]) - 1
        if 0 <= i < len(tpl.CONTINUE_VARIANTS):
            tpl.CONTINUE_VARIANTS[i] = _to_template_text(text)
    elif key == "opt_out_confirmation":
        oo.NL_CONFIRMATION = text


def _time(value: Any) -> "Any":
    from upsell_agent.agent.timing import parse_at
    return parse_at(value)


_FEDERAL = ("08:00", "21:00")


def _window(value: Any, *, legal: bool = True) -> "Any":
    """["08:00", "21:00"] as a window; None when not given. Never wider than federal 8 AM - 9 PM."""
    if not value or len(value) != 2:
        return None
    start, end = _time(value[0]), _time(value[1])
    if start is None or end is None or end <= start:
        raise ValueError(f"not a window: {value}")
    if legal:
        start, end = max(start, _time(_FEDERAL[0])), min(end, _time(_FEDERAL[1]))
    return (start, end)


def _apply_compliance(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    from datetime import timedelta
    mods = _by_name()
    if built_in is None:  # a rule the dealership added
        applies = [a for a in c.get("applies_to") or ["text", "email"] if a in ("text", "email")]
        CUSTOM_RULES.append({"name": _names.get(("compliance", key), key), "rule": str(c.get("rule") or "").strip(),
                             "applies_to": applies or ["text", "email"],
                             "banned": [str(p).strip() for p in c.get("banned_phrases") or [] if str(p).strip()]})
        return
    if key == "texting_hours":
        eng = mods["engine"]
        eng.REPLY_WINDOW = _window(c.get("reply_window")) or eng.REPLY_WINDOW
        eng.TRANSACTIONAL_WINDOW = _window(c.get("first_message_window")) or eng.TRANSACTIONAL_WINDOW
        eng.MARKETING_WINDOW = _window(c.get("follow_up_window")) or eng.MARKETING_WINDOW
        if c.get("follow_up_texts_per_period"):
            eng.MARKETING_SMS_CAP = int(c["follow_up_texts_per_period"])
        if c.get("period_hours"):
            eng.CAP_PERIOD = timedelta(hours=float(c["period_hours"]))
        if isinstance(c.get("dnd_statuses"), list):
            eng.DND_STATUSES.clear()
            eng.DND_STATUSES.update(str(s).strip().lower() for s in c["dnd_statuses"] if str(s).strip())
    elif key == "state_rules":
        sh = mods["state_hours"]
        rows = {}
        for row in c.get("rows") or []:
            state = str(row.get("state") or "").strip().upper()
            if not state:
                continue
            cap = (int(row["cap_texts"]), timedelta(hours=float(row.get("cap_hours") or 24))) \
                if row.get("cap_texts") else None
            auto = None
            if row.get("automated_weekday") or row.get("automated_cap_texts"):
                auto = {"weekday": _window(row.get("automated_weekday")),
                        "saturday": _window(row.get("automated_saturday")),
                        "sunday": _window(row.get("automated_sunday")),
                        "cap": (int(row["automated_cap_texts"]),
                                timedelta(hours=float(row.get("automated_cap_hours") or 24)))
                        if row.get("automated_cap_texts") else None, "cite": row.get("cite") or ""}
            old = _pristine[("state_hours", "STATE_RULES")].get(state)
            rows[state] = sh.StateRule(
                state, _window(row.get("weekday")) or _window(list(_FEDERAL)), _window(row.get("saturday")),
                _window(row.get("sunday")), bool(row.get("holidays_banned")), cap,
                old.verified if old else True, str(row.get("cite") or ""), str(row.get("note") or ""), auto,
                bool(row.get("no_unsolicited_sales_texts")))
        if rows:
            sh.STATE_RULES.clear()
            sh.STATE_RULES.update(rows)
    elif key == "opt_out":
        oo = mods["opt_out"]
        if isinstance(c.get("stop_words"), list) and c["stop_words"]:
            oo.STOP_WORDS.clear()
            oo.STOP_WORDS.update(str(w).strip().lower() for w in c["stop_words"] if str(w).strip())
            oo._STOP_TOKENS = {w.replace(" ", "").replace("-", "") for w in oo.STOP_WORDS}
        if isinstance(c.get("start_words"), list) and c["start_words"]:
            oo.START_WORDS.clear()
            oo.START_WORDS.update(str(w).strip().lower() for w in c["start_words"] if str(w).strip())
        if (pattern := words_to_pattern(c.get("extra_stop_phrases") or [])):
            oo._PHRASES.append((re.compile(pattern, re.IGNORECASE), None))
        if str(c.get("confirmation") or "").strip():
            oo.NL_CONFIRMATION = c["confirmation"].strip()
        if isinstance(c.get("inquiry_only"), bool):
            oo.INQUIRY_ONLY = c["inquiry_only"]
        if isinstance(c.get("stop_everything_phrases"), list):
            oo.STOP_EVERYTHING_PHRASES = [str(p).strip() for p in c["stop_everything_phrases"] if str(p).strip()]
        for field, name in (("inquiry_confirmation", "INQUIRY_CONFIRMATION"),
                            ("vehicle_updates_question", "VEHICLE_UPDATES_QUESTION"),
                            ("vehicle_updates_yes", "VEHICLE_UPDATES_YES")):
            if str(c.get(field) or "").strip():
                setattr(oo, name, c[field].strip())
    elif key == "text_invite":
        tc = mods["text_consent"]
        tc.INVITE = str(c.get("invite") or tc.INVITE)
        tc.CONFIRMATION = str(c.get("confirmation") or tc.CONFIRMATION)
    elif key == "channels":
        cons = mods["consent"]
        if c.get("first_channel") in ("text", "email"):
            cons.FIRST_CHANNEL = c["first_channel"]
        if c.get("at_night") in ("ask_now_or_later", "email_now_text_when_open", "wait_for_text", "email_only"):
            cons.AT_NIGHT = c["at_night"]
        words = [re.escape(str(w).strip()).replace("\\-", "-?") for w in c.get("placeholder_emails") or []
                 if str(w).strip()]
        if words:
            cons._PLACEHOLDER_EMAIL = re.compile(r"^(?:" + "|".join(words) + r")[+.@_-]", re.IGNORECASE)
    elif key == "conversation_rules":
        if c.get("questions_per_message"):
            mods["policy"].MAX_ASKS_PER_MESSAGE = max(1, min(3, int(c["questions_per_message"])))
        if isinstance(c.get("switch_ai_off_after_failed_drafts"), bool):
            mods["guard"].HANDOFF_AFTER_FAILED_DRAFTS = c["switch_ai_off_after_failed_drafts"]
        if isinstance(c.get("ai_resumes_after_staff_minutes"), (int, float)) and not isinstance(
                c["ai_resumes_after_staff_minutes"], bool):
            from datetime import timedelta as _td

            from upsell_agent.scheduler import followups as _fu
            minutes = max(0, int(c["ai_resumes_after_staff_minutes"]))
            _fu.STAFF_QUIET_AFTER = _td(minutes=minutes) if minutes else None
        if isinstance(c.get("busy_rule"), bool):
            mods["decide"].BUSY_RULE = c["busy_rule"]
        if isinstance(c.get("busy_phrases"), list):
            mods["decide"].BUSY_PHRASES = [str(p).strip() for p in c["busy_phrases"] if str(p).strip()]
    elif key == "photos_and_links":
        vm, sl, lr = mods["vehicle_media"], mods["short_links"], mods["link_resolver"]
        if isinstance(c.get("photo_on_first_message"), bool):
            vm.PHOTO_ON_FIRST_MESSAGE = c["photo_on_first_message"]
        if isinstance(c.get("photos_when_asked"), (int, float)) and not isinstance(c["photos_when_asked"], bool):
            vm.PHOTOS_ON_REQUEST = max(0, min(5, int(c["photos_when_asked"])))
        if isinstance(c.get("short_links"), bool):
            sl.ENABLED = c["short_links"]
        lr.SHAREABLE = {**lr.SHAREABLE, **{k.removeprefix("share_"): v for k, v in c.items()
                                            if k.startswith("share_") and isinstance(v, bool)}}
    elif key == "presend_check":
        ps = mods["presend"]
        ps.CHECKS = {**ps.CHECKS, **{k: v for k, v in c.items() if k in ps.CHECKS and isinstance(v, bool)}}
    elif key == "safeguards":
        for field, (mod, attr) in SAFEGUARD_SWITCHES.items():
            if isinstance(c.get(field), bool):
                setattr(mods[mod], attr, c[field])
        for field, (mod, attr, low, high) in SAFEGUARD_NUMBERS.items():
            value = c.get(field)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                setattr(mods[mod], attr, max(low, min(high, int(value))))
    elif key == "writing":
        dg, gd = mods["draft_guard"], mods["guard"]
        for field, attr in (("sms_max_characters", "SMS_MAX"), ("first_text_max_characters", "TOUCH1_SMS_MAX"),
                            ("cars_per_text", "SMS_MAX_VEHICLES"), ("cars_per_email", "EMAIL_MAX_VEHICLES")):
            if c.get(field):
                setattr(dg, attr, int(c[field]))
        if isinstance(c.get("banned_phrases"), list) and c["banned_phrases"] != (built_in or {}).get("banned_phrases"):
            pattern = words_to_pattern(c["banned_phrases"])
            gd._TEAM = re.compile(pattern or r"(?!x)x", re.IGNORECASE)
    # "contacted" is read by the CRM itself (aidmvcs-be-dev app/lib/contactedLeads.js).


_APPLY = {"compliance": _apply_compliance, "messages": _apply_message, "agents": _apply_agent, "buckets": _apply_bucket, "sources": _apply_sources,
          "workflows": _apply_workflow, "cadences": _apply_cadence, "status_rules": _apply_status_rules}
# Built-in messages and the prompts are read where they're used: message(), step_message(), compose_prompt().
