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
_names: dict[tuple[str, str], str] = {}  # each item's name in the Studio (an added agent's or workflow's label)
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
    except Exception:  # the AI keeps what it has (built-in or the last good read)
        logger.exception("could not read the AI Studio settings")


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
    for (kind, key), content in sorted(changed.items()):
        try:
            _APPLY.get(kind, lambda *_: None)(key, content, defaults.get((kind, key)))
        except Exception:  # one broken item never takes the others down
            logger.exception("AI Studio item %s/%s could not be applied; the built-in setting stays", kind, key)
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
    "buyers_order": ("ASKS", "START", "START_STEP", "_TEXT", "ESCALATE_AT", "FLOWS"),
    "cadence": ("DAY_THEMES", "NURTURE_THEMES", "DEEPER_THEMES", "EXTENDED_THEMES", "BY_ID", "SCHEDULE", "LAST_DAY"),
    "escalation": ("MANAGER_ESCALATIONS",),
    "lifecycle": ("STAFF_STATUS_EVENTS", "OPPORTUNITY_DAYS"),
    "sold_pending": ("STUDIO_DAYS",),
    "owner_touches": ("OWNER_TOUCH_DAYS",),
    "appointment": ("DETAILS_AFTER", "NO_SHOW_AFTER", "NO_SHOW_FOLLOWUP_AFTER"),
    "crm_status": ("CRM_STATUS_FOR_STAGE", "CRM_STATUS_FOR_EVENT"),
}


def _by_name() -> dict[str, Any]:
    b, cad, cs, crm, esc, lb, lc, sp, org = _modules()
    from upsell_agent.agent import appointment, owner_touches, sold_pending
    return {"specialists": sp, "lead_bucket": lb, "origin": org, "cannot_supply": cs, "buyers_order": b,
            "cadence": cad, "escalation": esc, "lifecycle": lc, "crm_status": crm, "sold_pending": sold_pending,
            "owner_touches": owner_touches, "appointment": appointment}


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
            setattr(modules[name], attr, value)


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


def _studio_to_script(text: str) -> str:
    """A workflow message as the script engines write it: {vehicle_link} is the payment calculator's link."""
    return str(text or "").replace(" {vehicle_link}", "{calculator}").replace("{vehicle_link}", "{calculator}")


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
        start, start_step, text, escalate_at = _flow(tree, prefix="")
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
    nested = any((b.get("then") or {}).get("action") == "ask" for b in tree.get("branches") or [])
    if topic in built_topics or not nested:
        # A one-message answer (Betsy's can't-supply scripts, or one added like them): code places it, and offers
        # two open times when it has {times}.
        if topic not in built_topics:
            topic = f"studio_{key}"
            cs.CUSTOM_LABELS[topic] = str(c.get("name") or _names.get(("workflows", key)) or key)
        text = fixed_text(tree.get("message") or {})
        if text:
            cs._REPLIES[topic] = _studio_to_script(text)
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
    start, start_step, text, escalate_at = _flow(tree, prefix=f"{key}:")
    if start:
        bo.FLOWS.append({"key": key, "asks": re.compile(trigger, re.IGNORECASE), "start": start,
                         "start_step": start_step})
        bo._TEXT.update(text)
        bo.ESCALATE_AT = frozenset({*bo.ESCALATE_AT, *escalate_at})


def _flow(tree: dict[str, Any], *, prefix: str) -> tuple[str | None, str | None, dict, set]:
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
    elif key == "ai_statuses":
        if isinstance(c.get("stages"), dict):
            mods["crm_status"].CRM_STATUS_FOR_STAGE.update({k: v for k, v in c["stages"].items() if v})
        if isinstance(c.get("closings"), dict):
            mods["crm_status"].CRM_STATUS_FOR_EVENT.update({k: v for k, v in c["closings"].items() if v})


def _apply_message(key: str, c: dict[str, Any], built_in: dict[str, Any] | None) -> None:
    """An added message is sent when the customer says one of its words (like a one-message workflow); the built-in
    ones are read where they're used (message())."""
    send_when = c.get("send_when") or {}
    if built_in is not None or not (send_when.get("phrases") or send_when.get("words")):
        return
    _apply_workflow(f"message_{key}", {"name": _names.get(("messages", key)), "trigger": send_when,
                                       "tree": {"id": "answer", "message": c.get("message") or {}, "branches": [
                                           {"when": {"value": "picks_a_time"}, "then": {"action": "book"}}]}},
                    None)


_APPLY = {"messages": _apply_message, "agents": _apply_agent, "buckets": _apply_bucket, "sources": _apply_sources,
          "workflows": _apply_workflow, "cadences": _apply_cadence, "status_rules": _apply_status_rules}
# Built-in messages and the prompts are read where they're used: message(), step_message(), compose_prompt().
