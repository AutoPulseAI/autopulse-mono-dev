"""The appointment workflow (MASTER_PLAN_3 C5; Omnichannel PDF §7-§10; diagrams:
docs/architecture/STATE_MACHINE_DIAGRAMS.md §12-§14).

Once a lead is at Appointment Set (the AI booked it, the customer moved it, or
staff booked it) these messages go out, all on text AND email together
(Omnichannel PDF p.10) and all with the client's own wording:

    touches before, not next-day      2-3 days out: one; 4+: one a day, a different text each (COUNTDOWN_TEXTS)
    the morning of, not same-day      "...confirming our meeting for today at {time}. Does this time still work?
                                       Please reply C to confirm or R to reschedule." (the day before if too early)
    appointment + 1 hour, no visit    No Show: "I am looking for you in the showroom - are you here and working
                                       with someone?"
    +24 hours, no reply               "How did everything go when you came in? Did you get a chance to stop by?"
    +24 hours, no reply               back to Contact Made - No Next Action, into the cadence (§9 step 3)

    15 minutes after it's set / moved  "{first}, we are all set to meet on {date} at {time} at {dealership},
                                       {address}. Please make sure to call or text us if anything changes at
                                       {ai_agent_phone}. Looking forward to assisting you!" (§7)

MASTER_PLAN_4 (stream R): the 15-minute details message is built now. It was left out while the platform sent
its own booking confirmation; the CRM's confirmations are off for AI dealers (stream C1), so this is the
customer's only confirmation. Sent once per appointment time (a move sends it again for the new time), and
for a same-day appointment only while it is still useful (DETAILS_MIN_LEAD before the meeting).

**Photos (MASTER_PLAN_4 F3):** the countdown and the +1h message call for a
vehicle photo. scheduler/followups.py attaches the photo of the vehicle the lead
is about (agent/vehicle_media.py `lead_vehicle_vin`), a different one each
countdown day where the vehicle has several. No vehicle on record, or no usable
photo: text only, the client's own fallback ("Photo unavailable: never
fabricate/unrelated photo; use ... a non-photo message", §15).

Nothing here touches the database or the clock: scheduler/followups.py plans
and fires the steps, events/handlers.py reads the customer's Y / N.
"""

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Any, Literal

# Day-before and countdown messages go out at this dealer-local hour (our default: the PDF gives days, not
# times). The send check moves them to the first time the customer's own window and the dealer allow.
STEP_HOUR = time(10)
NO_SHOW_AFTER = timedelta(hours=1)
NO_SHOW_FOLLOWUP_AFTER = timedelta(hours=24)
# How long the customer has to answer the "how did everything go" message before the lead goes back into
# follow-up. The PDF says only "no response after Step 2 window" (§9); 24 hours, like the gap before it.
NO_SHOW_CLOSE_AFTER = timedelta(hours=24)
# Stream X2: "I am looking for you in the showroom" is only true shortly after the appointment. A +1h message that
# can't go out by this long after the appointment (the dealership shut after a late appointment) is replaced by the
# +24h "how did everything go" message instead of arriving a day and a half late.
NO_SHOW_MESSAGE_LATEST = timedelta(hours=2)
# A day-before confirmation that would land closer than this to the appointment is skipped ("any
# nonsensical day-before confirmation", §7).
MIN_CONFIRM_LEAD = timedelta(hours=2)
MAX_COUNTDOWNS = 10
# Betsy, 27 Oct 2026: "if the appointment is for tomorrow I don't need to send anything else - I send them the
# confirmation the morning of"; two or three days out, one touch; four or more, "message them every single day
# something different". The confirmation goes the morning of the appointment (no earlier than CONFIRM_EARLIEST); an
# appointment too early in the day for that gets it the day before, as before.
CONFIRM_EARLIEST = time(9)
ONE_TOUCH_UP_TO_DAYS = 3
# MASTER_PLAN_4 (stream R): the details message goes this long after the appointment is set or moved ("allowing
# time for correction", §7), and only while the appointment is at least DETAILS_MIN_LEAD away.
DETAILS_AFTER = timedelta(minutes=15)
DETAILS_MIN_LEAD = timedelta(minutes=30)

STEP_DETAILS = "details"
STEP_CONFIRM = "confirm"
STEP_COUNTDOWN = "countdown"
STEP_NO_SHOW_CHECK = "no_show_check"
STEP_NO_SHOW_FOLLOWUP = "no_show_followup"
STEP_NO_SHOW_CLOSE = "no_show_close"
KIND_PREFIX = "appointment_"

Answer = Literal["yes", "no", "ambiguous", "other"]


@dataclass
class Step:
    step: str
    due_at: datetime
    why: str

    @property
    def kind(self) -> str:
        return KIND_PREFIX + self.step

    def as_dict(self) -> dict[str, Any]:
        return {"step": self.step, "due_at": self.due_at.isoformat(), "why": self.why}


_GREETS = re.compile(r"^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|dear)\b", re.IGNORECASE)


def aware(value: Any, tz) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    # MongoDB hands back naive datetimes that are UTC.
    return value.astimezone(tz) if value.tzinfo else value.replace(tzinfo=UTC).astimezone(tz)


def appointment_at(*, tz, booking: dict | None = None, lead: dict | None = None,
                   recorded: dict | None = None) -> datetime | None:
    """When the appointment is, in the dealer's time zone: the booking's own date and time (the platform
    stores `bookingDate` as dealer-local midnight in UTC and `bookingTime` as dealer-local HH:MM), else the
    lead's own booking fields (a status staff set), else what the lead state recorded."""
    if booking and booking.get("bookingDate") and booking.get("bookingTime"):
        day = aware(booking["bookingDate"], tz)
        if day is not None:
            try:
                hour, minute = (int(x) for x in str(booking["bookingTime"]).split(":")[:2])
            except ValueError:
                hour = None
            if hour is not None:
                return datetime.combine(day.date(), time(hour, minute), tzinfo=tz)
    stored = ((lead or {}).get("booking") or {}) or (((lead or {}).get("data") or {}).get("booking") or {})
    if at := aware(stored.get("booking_at"), tz):
        return at
    if stored.get("booking_date") and stored.get("booking_time"):
        day = aware(stored["booking_date"], tz)
        if day is not None:
            try:
                hour, minute = (int(x) for x in str(stored["booking_time"]).split(":")[:2])
                return datetime.combine(day.date(), time(hour, minute), tzinfo=tz)
            except ValueError:
                pass
    if recorded and recorded.get("at"):
        iso = recorded["at"]
        try:
            return aware(datetime.fromisoformat(iso) if isinstance(iso, str) else iso, tz)
        except ValueError:
            return None
    return None


def plan_steps(appt_at: datetime, *, now: datetime, tz) -> list[Step]:
    """Every message the appointment still owes, from `now`. A same-day appointment gets neither the
    countdown nor the day-before confirmation (§7: "skip daily pre-appointment countdown/photo messages and
    any nonsensical day-before confirmation")."""
    local_now = now.astimezone(tz)
    appt = appt_at.astimezone(tz)
    steps: list[Step] = []
    if appt <= local_now - NO_SHOW_AFTER:
        return steps  # long past: nothing to remind and nothing to chase
    appt_day, today = appt.date(), local_now.date()
    if appt_day > today:
        confirm_at = min(datetime.combine(appt_day, STEP_HOUR, tzinfo=tz), appt - MIN_CONFIRM_LEAD)
        why = "the morning-of confirmation, asking C to confirm or R to reschedule"
        if confirm_at < datetime.combine(appt_day, CONFIRM_EARLIEST, tzinfo=tz):
            confirm_at = datetime.combine(appt_day - timedelta(days=1), STEP_HOUR, tzinfo=tz)
            if confirm_at <= local_now:
                confirm_at = local_now + timedelta(minutes=30)
            why = "the confirmation, the day before (the appointment is too early for a morning-of one)"
        if local_now < confirm_at <= appt - MIN_CONFIRM_LEAD:
            steps.append(Step(STEP_CONFIRM, confirm_at, why))
        days_out = (appt_day - today).days
        touch_days = [today + timedelta(days=n) for n in range(1, days_out)]
        if days_out <= ONE_TOUCH_UP_TO_DAYS:
            touch_days = touch_days[:1]
        confirm_day = next((st.due_at.date() for st in steps if st.step == STEP_CONFIRM), None)
        touch_days = [d for d in touch_days if d != confirm_day]  # one message that day, not two
        for day in touch_days[:MAX_COUNTDOWNS]:
            at = datetime.combine(day, STEP_HOUR, tzinfo=tz)
            if at > local_now:
                steps.append(Step(STEP_COUNTDOWN, at, "a touch before the meeting (a different message each day)"))
    steps.append(Step(STEP_NO_SHOW_CHECK, appt + NO_SHOW_AFTER,
                      "appointment time + 1 hour: still no Sales Visit means No Show"))
    return sorted(steps, key=lambda s: s.due_at)


def details_step(appt_at: datetime, *, now: datetime) -> Step | None:
    """The 15-minute details message (§7, stream R), or None when the appointment is too close for it to help
    (a same-day booking for the next half hour: the customer is on their way)."""
    due = now + DETAILS_AFTER
    if due > appt_at - DETAILS_MIN_LEAD:
        return None
    return Step(STEP_DETAILS, due, "15 minutes after the appointment was set: the details, allowing time to correct")


def details_still_useful(appt_at: datetime | None, *, now: datetime) -> bool:
    """At send time: a details message held past the point where it helps is dropped, not sent late."""
    return appt_at is not None and now <= appt_at - timedelta(minutes=15)


# --- The customer's answer to the day-before message (§8) ---------------------------------------------------

# Betsy, 27 Oct 2026 (Michael Gaston-Simpson answered "C" and was asked again for Y or N): AI Studio's confirmation asks
# for "C to confirm or R to reschedule" - C / R are answers too.
_YES = re.compile(r"^\s*(?:y|c|yes|yep|yeah|yup|yea|sure|ok|okay|k|confirmed?|that works|works for me|"
                  r"works|sounds good|see you then|see you there|i'?ll be there|will do|absolutely|definitely)"
                  r"[\s.!,]*(?:thanks?|thank you)?[\s.!]*$", re.IGNORECASE)
_NO = re.compile(r"^\s*(?:n|r|no|nope|nah|reschedule|can'?t|cannot|can not|doesn'?t work|does not work|"
                 r"no,? (?:i )?can'?t|not (?:anymore|any more|really|going to work)|won'?t work)"
                 r"[\s.!,]*(?:sorry)?[\s.!]*$", re.IGNORECASE)


def classify_answer(text: str) -> Answer:
    """Y / clear yes, N / clear no, ambiguous (a short reply that is neither), or other (anything longer or
    a question: that is a conversation, answered normally, not a confirmation, §8)."""
    body = (text or "").strip()
    if not body:
        return "other"
    if _YES.match(body):
        return "yes"
    if _NO.match(body):
        return "no"
    if "?" not in body and len(body.split()) <= 3:
        return "ambiguous"
    return "other"


# --- The client's own message texts -------------------------------------------------------------------------------

def _first(name: str | None) -> str:
    from upsell_agent.agent.templates import first_name
    return first_name(name)


def _when(appt: datetime) -> tuple[str, str]:
    """("today" / "tomorrow" / "Friday, October 30", "2:31 PM") - Betsy, 27 Oct 2026: "instead of today and tomorrow
    it says Tuesday October 27"."""
    from upsell_agent import clock
    today = clock.now().astimezone(appt.tzinfo).date() if appt.tzinfo else clock.now().date()
    day = {0: "today", 1: "tomorrow"}.get((appt.date() - today).days,
                                         f"{appt.strftime('%A')}, {appt.strftime('%B')} {appt.day}")
    return day, appt.strftime("%I:%M %p").lstrip("0")


_ON_RELATIVE = re.compile(r"\b(on|for) (today|tomorrow)\b", re.IGNORECASE)


def _relative_words(text: str) -> str:
    """"meet on today" -> "meet today", "our meeting for tomorrow" stays: only "on" goes (AI Studio's own text
    says "on {date}")."""
    return _ON_RELATIVE.sub(lambda m: m.group(2) if m.group(1).lower() == "on" else m.group(0), text)


# Betsy, 27 Oct 2026: four or more days out, "every single day something different". The touch before the meeting
# rotates through these; AI Studio's countdown text is the first. Nothing here offers what the AI can't deliver.
COUNTDOWN_TEXTS = (
    "Counting down to our meeting at {place}!",
    "{first}, a quick tip for your visit {day}: bring your driver's license, and your registration if you're "
    "trading in. It saves time.",
    "Looking forward to seeing you {day} at {at} at {place}. Any questions before then? Just text me here.",
    "If you're trading in a vehicle, text me its year, make, model and miles, and we'll have numbers ready when "
    "you arrive.",
    "Your visit {day} at {at} is on our calendar. If anything changes, reply R and I'll find you a new time.",
)


def render_message(step: str, *, customer_name: str | None, dealership: str | None, agent_name: str | None,
                   appt: datetime | None, model: str | None = None, address: str | None = None,
                   agent_phone: str | None = None, variant: int = 0) -> dict[str, str]:
    """The step's message: as published in AI Studio when edited there (client, 13 Oct 2026), else the built-in.
    `variant` picks the countdown text (0 = AI Studio's / the first built-in)."""
    built = _render_built_in(step, customer_name=customer_name, dealership=dealership, agent_name=agent_name,
                             appt=appt, model=model, address=address, agent_phone=agent_phone, variant=variant)
    if step == STEP_COUNTDOWN and variant % len(COUNTDOWN_TEXTS):
        return built
    from upsell_agent import ai_studio
    from upsell_agent.agent.templates import FALLBACK_NAME
    day, at = _when(appt) if appt else ("", "")
    first = _first(customer_name)
    values = {"first_name": first if first != FALLBACK_NAME else None, "dealership": dealership or "the dealership",
              "agent_name": agent_name, "model": model, "address": address, "dealer_phone": agent_phone,
              "date": day, "time": at}
    out = ai_studio.render(ai_studio.step_message("cadences", "appointment", step), values, built) or built
    return {k: _relative_words(v) if isinstance(v, str) else v for k, v in out.items()}


def _render_built_in(step: str, *, customer_name: str | None, dealership: str | None, agent_name: str | None,
                     appt: datetime | None, model: str | None = None, address: str | None = None,
                     agent_phone: str | None = None, variant: int = 0) -> dict[str, str]:
    """{sms_text, email_subject, email_body} for one appointment step, in the client's words (Omnichannel
    PDF §7, §9). A name the record doesn't have is left out rather than invented."""
    first = _first(customer_name)
    place = dealership or "the dealership"
    day, at = _when(appt) if appt else ("", "")
    if step == STEP_DETAILS:
        # §7 word for word; a missing name, address or phone is left out with its own words, never invented.
        from upsell_agent.agent.templates import FALLBACK_NAME
        known = first if first != FALLBACK_NAME else None
        where = f"{place}, {address}" if address else place
        opening = f"{known}, we are all set" if known else "We are all set"
        call = (f"Please make sure to call or text us if anything changes at {agent_phone}." if agent_phone
                else "Please make sure to call or text us if anything changes.")
        text = f"{opening} to meet on {day} at {at} at {where}. {call} Looking forward to assisting you!"
        subject = f"Your appointment at {place}"
        return {"sms_text": text, "email_subject": subject, "email_body": f"{text}\n\nThanks,\n{place}"}
    elif step == STEP_COUNTDOWN:
        from upsell_agent.agent.templates import FALLBACK_NAME
        text = COUNTDOWN_TEXTS[variant % len(COUNTDOWN_TEXTS)].format(place=place, day=day, at=at, first=first)
        if first == FALLBACK_NAME:
            text = text.replace(f"{first}, a quick", "A quick")
        subject = "Before your visit"
    elif step == STEP_CONFIRM:
        who = f"this is {agent_name} at {place}" if agent_name else f"it's {place}"
        text = (f"Hello, {first}, {who} confirming our meeting for {day} at {at}. "
                "Does this time still work? Please reply C to confirm or R to reschedule.")
        subject = "Does this time still work?"
    elif step == STEP_NO_SHOW_CHECK:
        who = f"this is {agent_name} with {place}" if agent_name else f"this is {place}"
        text = (f"Hello, {who}. I am looking for you in the showroom - "
                "are you here and working with someone?")
        subject = "Are you here?"
    elif step == STEP_NO_SHOW_FOLLOWUP:
        who = f"This is {agent_name} at {place}" if agent_name else f"This is {place}"
        about = f"your {model} purchase" if model else "your visit"
        text = (f"Hi! {who} regarding {about}. How did everything go when you came in? "
                "Did you get a chance to stop by?")
        subject = "How did everything go?"
    else:
        raise ValueError(f"no message for step {step!r}")
    # Michael Gaston-Simpson, 26 Oct 2026: "Hi Michael, Hello, Michael, this is Nicole ..." - AI Studio's text greets him
    # already; the email adds its "Hi" only when it doesn't.
    opening = "" if _GREETS.match(text) else f"Hi {first},\n\n"
    return {"sms_text": text, "email_subject": subject, "email_body": f"{opening}{text}\n\nThanks,\n{place}"}


def reply_text(kind: str, *, customer_name: str | None, appt: datetime | None,
               offered: list[str] | None = None) -> str:
    """The AI's short replies to the customer's Y / N (§8)."""
    first = _first(customer_name)
    day, at = _when(appt) if appt else ("", "")
    if kind == "confirmed":
        return f"Perfect, thank you, {first}! See you {day} at {at}."
    if kind == "clarify":
        return "Just to be sure, does that time still work? Please reply C to confirm or R to reschedule."
    if kind == "reschedule":
        if offered:
            options = offered[0] if len(offered) == 1 else ", ".join(offered[:-1]) + f", or {offered[-1]}"
            return f"No problem, {first}. I can do {options}. Which works better?"
        return f"No problem, {first}. What day and time would work better for you?"
    raise ValueError(kind)
