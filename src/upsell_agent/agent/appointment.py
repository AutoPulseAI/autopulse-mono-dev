"""The appointment workflow (MASTER_PLAN_3 C5; Omnichannel PDF §7-§10; diagrams:
docs/architecture/STATE_MACHINE_DIAGRAMS.md §12-§14).

Once a lead is at Appointment Set (the AI booked it, the customer moved it, or
staff booked it) these messages go out, all on text AND email together
(Omnichannel PDF p.10) and all with the client's own wording:

    each day before, not same-day     "Counting down to our meeting at {dealership}!"
    the day before, not same-day      "...confirming our meeting for {date} at {time}. Does this time still work?
                                       Please reply Y for Yes or N for No."
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
# A day-before confirmation that would land closer than this to the appointment is skipped ("any
# nonsensical day-before confirmation", §7).
MIN_CONFIRM_LEAD = timedelta(hours=2)
MAX_COUNTDOWNS = 6
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
        before = appt_day - timedelta(days=1)
        confirm_at = datetime.combine(before, STEP_HOUR, tzinfo=tz)
        if confirm_at <= local_now:
            confirm_at = local_now + timedelta(minutes=30)
        if confirm_at <= appt - MIN_CONFIRM_LEAD:
            steps.append(Step(STEP_CONFIRM, confirm_at, "the day-before confirmation, asking for Y or N"))
        day: date = today + timedelta(days=1)
        count = 0
        while day <= appt_day - timedelta(days=2) and count < MAX_COUNTDOWNS:
            at = datetime.combine(day, STEP_HOUR, tzinfo=tz)
            if at > local_now:
                steps.append(Step(STEP_COUNTDOWN, at, "a daily countdown to the meeting"))
                count += 1
            day += timedelta(days=1)
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

_YES = re.compile(r"^\s*(?:y|yes|yep|yeah|yup|yea|sure|ok|okay|k|confirmed?|that works|works for me|"
                  r"works|sounds good|see you then|see you there|i'?ll be there|will do|absolutely|definitely)"
                  r"[\s.!,]*(?:thanks?|thank you)?[\s.!]*$", re.IGNORECASE)
_NO = re.compile(r"^\s*(?:n|no|nope|nah|can'?t|cannot|can not|doesn'?t work|does not work|"
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
    return (f"{appt.strftime('%A')}, {appt.strftime('%B')} {appt.day}",
            appt.strftime("%I:%M %p").lstrip("0"))


def render_message(step: str, *, customer_name: str | None, dealership: str | None, agent_name: str | None,
                   appt: datetime | None, model: str | None = None, address: str | None = None,
                   agent_phone: str | None = None) -> dict[str, str]:
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
        text = f"Counting down to our meeting at {place}!"
        subject = "Counting down to our meeting"
    elif step == STEP_CONFIRM:
        who = f"this is {agent_name} at {place}" if agent_name else f"it's the team at {place}"
        text = (f"Hello, {first}, {who} confirming our meeting for {day} at {at}. "
                "Does this time still work? Please reply Y for Yes or N for No.")
        subject = "Does this time still work?"
    elif step == STEP_NO_SHOW_CHECK:
        who = f"this is {agent_name} with {place}" if agent_name else f"this is the team at {place}"
        text = (f"Hello, {who}. I am looking for you in the showroom - "
                "are you here and working with someone?")
        subject = "Are you here?"
    elif step == STEP_NO_SHOW_FOLLOWUP:
        who = f"This is {agent_name} at {place}" if agent_name else f"This is the team at {place}"
        about = f"your {model} purchase" if model else "your visit"
        text = (f"Hi! {who} regarding {about}. How did everything go when you came in? "
                "Did you get a chance to stop by?")
        subject = "How did everything go?"
    else:
        raise ValueError(f"no message for step {step!r}")
    return {"sms_text": text, "email_subject": subject, "email_body": f"Hi {first},\n\n{text}\n\nThanks,\n{place}"}


def reply_text(kind: str, *, customer_name: str | None, appt: datetime | None,
               offered: list[str] | None = None) -> str:
    """The AI's short replies to the customer's Y / N (§8)."""
    first = _first(customer_name)
    day, at = _when(appt) if appt else ("", "")
    if kind == "confirmed":
        return f"Perfect, thank you, {first}! See you {day} at {at}."
    if kind == "clarify":
        return "Just to be sure, does that time still work? Please reply Y for Yes or N for No."
    if kind == "reschedule":
        if offered:
            options = offered[0] if len(offered) == 1 else ", ".join(offered[:-1]) + f", or {offered[-1]}"
            return f"No problem, {first}. I can do {options}. Which works better?"
        return f"No problem, {first}. What day and time would work better for you?"
    raise ValueError(kind)
