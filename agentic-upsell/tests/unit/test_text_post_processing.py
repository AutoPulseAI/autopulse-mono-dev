"""Every step that rewrites the AI's text after it is written (agent/nodes/compose.py, in production order) must never
break text that was fine (the user, 12 Nov 2026: Naty Coria / Emily Chandler / Sawyer Buffum got the "come in" template
because removing one sentence glued the sign-off on - "...new car!Thank you"). Run on drafts written the way people and
models write today: paragraphs and sign-offs, slashes (w/, and/or, A/C, 2024/25), emojis, prices, times, abbreviations,
links, bullet lines, ellipses, dashes, Spanish.

The rules, for every step and for the whole chain:
- no grammar problem the draft didn't already have (guardrails/grammar.py - what the guard rejects drafts for);
- the email keeps its paragraphs, and its sign-off stays its own last paragraph;
- nothing is cut off mid-sentence; no doubled spaces, no space before punctuation, no orphan punctuation.
"""

import re

import pytest

from upsell_agent.agent.nodes import compose
from upsell_agent.guardrails.grammar import check_draft_grammar

INTRO = "Hi Maria, this is Nicole, Victory Cars Central's AI Sales Manager, following up on your interest in the 2024 Honda CR-V."
PRICE = "It's listed at $27,995, not including tax, documentation and DMV fees."

BODIES = [
    # plain paragraphs + sign-off
    "Hi Maria,\n\nThanks for reaching back out! The CR-V is still here.\n\nWhat day works best for you?\n\nThank you",
    # slashes, A/C, w/, and/or, years
    "Hi Maria,\n\nIt comes w/ leather, A/C and a 2024/25 warranty. Cash and/or financing both work.\n\nThank you",
    # times, prices, abbreviations, emoji
    "Hi Maria,\n\nWe're on Hempstead Tpke. near St. John's. It's $27,995 and I have 2:30 PM or 5:00 PM open 🙂\n\nThank you",
    # link, ellipsis, dash
    "Hi Maria,\n\nHere's the page: https://victory.example/cr-v-2024... It's a clean one - one owner.\n\nThank you",
    # bullet lines
    "Hi Maria,\n\nHere's what's included:\n- Leather seats\n- Sunroof\n- Apple CarPlay\n\nThank you",
    # Spanish
    "Hola Maria,\n\nGracias por escribirnos. ¿Qué día le conviene venir?\n\nGracias",
    # a promise that the not-interested rule removes, in the middle
    "Hi Maria,\n\nCongratulations on your new car! Our sales manager will reach out shortly. Enjoy it!\n\nThank you",
    # a promise as its own paragraph
    "Hi Maria,\n\nThanks for letting me know.\n\nSomeone will follow up with you.\n\nThank you",
    # a doubled word and two fee notes
    "Hi Maria,\n\nThe the CR-V is $27,995, not including tax, documentation and DMV fees. The RAV4 is $24,919, not "
    "including tax, documentation and DMV fees.\n\nThank you",
    # repeated day names
    "Hi Maria,\n\nI have tomorrow (Wednesday) at 10:00 AM, tomorrow (Wednesday) at 2:00 PM or tomorrow (Wednesday) at "
    "5:00 PM.\n\nThank you",
    # multi-line sign-off with a name
    "Hi Maria,\n\nThe CR-V is here and ready for a test drive.\n\nThank you,\nNicole",
    # Windows line breaks, triple blank lines, trailing spaces
    "Hi Maria,\r\n\r\nThe CR-V is here.   \r\n\r\n\r\nWhat day works for you?\r\n\r\nThank you",
    # spaced slash, !!, ??, caps, quotes
    "Hi Maria,\n\nCash / finance - both are fine!! You asked \"is it AWD??\" YES, it is.\n\nThank you",
    # engine, decimals, k, abbreviations
    "Hi Maria,\n\nIt has the 1.5L turbo, $27,995.00 list (about 27.9k), e.g. heated seats. Open 9 a.m. in the U.S. "
    "Northeast.\n\nThank you",
    # the price as a question, and price + promise in one email
    "Hi Maria,\n\nIt's $27,995 - does that work for you?\n\nOur team will reach out with the paperwork.\n\nThank you",
    # the AI's own price sentence, plain (removed: code places the price line)
    "Hi Maria,\n\nIt is listed at $27,995.\n\nIt has one owner and a clean history.\n\nThank you",
]
SMS = [
    "Thanks for reaching back out! The CR-V is still here. What day works best for you?",
    "It comes w/ leather, A/C and a 2024/25 warranty. Cash and/or financing both work.",
    "Congratulations on your new car! Our sales manager will reach out shortly. Enjoy it!",
    "The CR-V is here 🙂 I have 2:30 PM or 5:00 PM. We also have a 2023 RAV4 XLE in Magnetic Gray with 21,000 miles.",
    "It's $27,995 and I have 2:30 PM or 5:00 PM open 🙂",
    "It is listed at $27,995. It has one owner. What are you driving now?",
    "Cash / finance - both fine!! Is 2:30 PM ok??",
]
_TOUCH1 = {"intro": INTRO, "price_line": PRICE, "vin": "VIN0000000000CR01", "lead_answers": None, "ending": None}
DECISIONS = [
    {},
    {"not_interested": {"mode": "handoff", "reason": "bought elsewhere"}},
    {"touch1": _TOUCH1},
    {"touch1": _TOUCH1, "not_interested": {"mode": "handoff", "reason": "bought elsewhere"}},
]

_SIGN_OFF = re.compile(r"\r?\n\s*\n(?:Thank you|Gracias)(?:,\r?\n\w+)?$")


def _paragraphs(text: str) -> int:
    return len([p for p in re.split(r"\n\s*\n", text) if p.strip()])


def _chain(draft: dict, decision: dict) -> dict:
    """The compose post-processing, in the order compose() runs it (the steps that only place code-written text when
    the decision asks for it run with this decision)."""
    compose.one_day_name(draft)
    compose.no_promise_after_not_interested(draft, decision)
    compose.place_touch1_intro(draft, (decision.get("touch1") or {}).get("intro"))
    compose.place_touch1_extras(draft, decision.get("touch1"))
    compose.place_after_hours_wording(draft, decision)
    compose.one_fee_note(draft)
    compose.no_doubled_words(draft)
    compose.one_option_when_long(draft, 160)
    return draft


def _mechanical(text: str) -> list[str]:
    problems = []
    if re.search(r"[^\s\n] {2,}\S", text):
        problems.append("doubled space")
    if re.search(r"\s[,.!?;:](?!\d)", text.replace("...", "").replace(" - ", " ")):
        problems.append("space before punctuation")
    if re.search(r"[.!?][A-Za-z]", re.sub(r"https?://\S+|\b(?:[A-Za-z]\.){2,}|\b\w+\.(?:com|net|org|example)\b", "", text)):
        problems.append("two sentences glued together")
    if re.search(r"(?:^|\n)\s*[,.;:]", text):
        problems.append("orphan punctuation at a line start")
    return problems


@pytest.mark.parametrize("decision", DECISIONS, ids=["plain", "not_interested", "first_message", "both"])
@pytest.mark.parametrize("body", BODIES, ids=range(len(BODIES)))
def test_the_email_survives_every_step(body, decision):
    draft = {"email_body": body, "sms_text": "Thanks for reaching back out!", "email_subject": "Your inquiry"}
    before_grammar = set(check_draft_grammar(dict(draft)))
    after = _chain(dict(draft), decision)
    text = after["email_body"]
    assert not (set(check_draft_grammar(after)) - before_grammar), (text, check_draft_grammar(after))
    assert not _mechanical(text), (_mechanical(text), text)
    if _SIGN_OFF.search(body):
        assert _SIGN_OFF.search(text), f"sign-off not its own paragraph: {text!r}"
    removed = 1 if decision.get("not_interested") and re.search(r"(?:follow up with you|reach out with the paperwork)\.\n", body) else 0
    removed += 1 if decision.get("touch1") and "It is listed at $27,995.\n" in body else 0
    assert _paragraphs(text) >= _paragraphs(body) - removed, f"paragraphs collapsed: {text!r}"


@pytest.mark.parametrize("decision", DECISIONS, ids=["plain", "not_interested", "first_message", "both"])
@pytest.mark.parametrize("sms", SMS, ids=range(len(SMS)))
def test_the_text_survives_every_step(sms, decision):
    draft = {"sms_text": sms, "email_body": "Hi Maria,\n\nThanks.\n\nThank you", "email_subject": "Your inquiry"}
    before_grammar = set(check_draft_grammar(dict(draft)))
    after = _chain(dict(draft), decision)
    assert not (set(check_draft_grammar(after)) - before_grammar), (after["sms_text"], check_draft_grammar(after))
    assert not _mechanical(after["sms_text"]), (_mechanical(after["sms_text"]), after["sms_text"])
    assert re.search(r"[.!?🙂)]\s*$", after["sms_text"]), f"cut off: {after['sms_text']!r}"


@pytest.mark.parametrize(("text", "want"), [
    ("It has the 1.5L turbo, e.g. heated seats. Open 9 a.m. in the U.S. Northeast.",
     ["It has the 1.5L turbo, e.g. heated seats.", "Open 9 a.m. in the U.S. Northeast."]),
    ("We are near St. John's. Come by!", ["We are near St. John's.", "Come by!"]),
    ("Ask John F. Kennedy. He knows.", ["Ask John F. Kennedy.", "He knows."]),
    ("It is $27,995. Is 2:30 PM ok? Yes!", ["It is $27,995.", "Is 2:30 PM ok?", "Yes!"]),
    ("cash / finance - both fine!! ok??", ["cash / finance - both fine!! ok??"]),
])
def test_sentences_are_split_where_sentences_end(text, want):
    assert compose.split_sentences(text) == want


# The guard's grammar check on normal writing (12 Nov 2026): a false rejection sends the safe template instead of the
# AI's reply, so normal writing must pass and real slips must still be caught.
@pytest.mark.parametrize(("text", "flagged"), [
    ("It's $27,995 and I have 2:30 PM or 5:00 PM open 🙂", False),
    ("See you then :)", False),
    ("Thanks!!! 🙏", False),
    ("Hi Maria - quick one: is Tues. ok?", False),
    ("We're on Hempstead Tpke. near St. John's.", False),
    ("Open Mon. through Sat. from 9 a.m. to 8 p.m. today.", False),
    ("It comes w/ leather, A/C and a 2024/25 warranty. Cash and/or financing both work.", False),
    ("ok, sounds good 👍", True),
    ("The the car is here.", True),
    ("Thanks for reaching out", True),
    ("see you tomorrow.", True),
    ("It is here.See you", True),
    ("We are open. come by!", True),
])
def test_the_grammar_check_passes_normal_writing_and_catches_slips(text, flagged):
    assert bool(check_draft_grammar({"sms_text": text, "email_body": ""})) is flagged
