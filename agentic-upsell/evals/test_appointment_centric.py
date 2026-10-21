"""Appointment-centric evals (client, 20-21 Oct 2026 - Betsy: "It's supposed to QUALIFY for DATA and LEVERAGE DATA
to get APPOINTMENTS"; "the AI gets the conversation going and abandons").

Each case in datasets/appointment_cases.jsonl is one of Betsy's own example conversations (credit, trade-in,
price/payment - 21 Sep 2026) or a problem she or Bibi reported, run through the real handlers
(evals/harness.py run_conversation) and checked two ways:

- Rules, every run (offline or real models): one question per reply, never "the team will" / "let me know when
  you're ready", real times offered by the end, a time the customer names gets booked, no approval promised, no
  value or price that isn't the customer's own, never "here is a link" without one.
- Leverage judge, real models only: a judge model scores the whole conversation on Betsy's standard - Capture ->
  Interpret -> Leverage -> Advance (APPOINTMENT_JUDGE_MODEL, default gpt-4.1-mini; threshold 0.7).

- Offline (default): pytest evals/test_appointment_centric.py
- Real models:  MODEL_EXTRACT=openai:gpt-5-mini MODEL_COMPOSE=openai:gpt-5 OPENAI_API_KEY=... pytest evals/test_appointment_centric.py
"""

import asyncio
import json
import os
import re
from pathlib import Path

import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase, SingleTurnParams

from evals import harness
from evals.test_replies import _Rules
from upsell_agent.config import get_settings

CASES = [json.loads(line) for line in (Path(__file__).parent / "datasets" / "appointment_cases.jsonl")
         .read_text(encoding="utf-8").splitlines() if line.strip()]
TIME = re.compile(r"\b\d{1,2}(?::\d{2})?\s?(?:AM|PM|am|pm)\b")
DEAD_ENDS = ("when you're ready", "whenever you're ready", "let me know when", "let us know", "the team will",
             "just say when",
             "a member of our team", "someone will reach out", "someone will get back")
LINK_PROMISE = re.compile(r"\bhere(?:'s| is)\b[^.?!]{0,40}\blink\b", re.IGNORECASE)
MONEY = re.compile(r"\$\s?\d[\d,]*")
JUDGE_THRESHOLD = 0.7



def _real_models_ready() -> str | None:
    if not harness.uses_real_models():
        return None
    if not get_settings().openai_api_key.startswith("sk-"):
        return "real-model evals need OPENAI_API_KEY"
    return None


class AppointmentRules(_Rules):
    name = "Appointment rules"

    def rules(self) -> dict[str, bool]:
        expect = self.case["expect"]
        replies = [r for r in self.result["replies"] if r["reply"]]
        said = [r["reply"].replace("\u2019", "'") for r in replies]  # curly apostrophes read as straight ones
        last = said[-1] if said else ""
        customer_money = {m.replace(" ", "") for t in self.case.get("messages", []) for m in MONEY.findall(t)}
        rules: dict[str, bool] = {"every customer message got a reply or a reason": self.result["unanswered"] == 0}
        # The first text's closing question and the after-hours choice may come together (client rule): one each.
        rules["one question per reply"] = all(t.count("?") <= 1 for t in said[1:])
        for phrase in DEAD_ENDS:
            rules[f"never {phrase!r}"] = not any(phrase in t.lower() for t in said)
        rules["no backup template"] = not any(r["used_fallback"] for r in replies)
        if expect.get("offers_times_by_end"):
            rules["real times offered by the end"] = any(TIME.search(t) for t in said[-2:])
        if expect.get("booked_or_times"):
            rules["the time they named is booked or the nearest times offered"] = bool(
                re.search(r"all set|booked|see you|reserved", last, re.IGNORECASE) or TIME.search(last))
        if expect.get("leverage_any"):
            rules[f"uses what they told us ({expect['leverage_any']})"] = any(
                w.lower() in t.lower() for t in said[1:] for w in expect["leverage_any"])
        for word in expect.get("never", []):
            rules[f"never says {word!r}"] = not any(re.search(rf"\b{re.escape(word)}\b", t, re.IGNORECASE)
                                                    for t in said)
        if expect.get("no_money_but_theirs"):
            rules["no dollar amount that isn't the customer's own"] = all(
                m.replace(" ", "") in customer_money for t in said[1:] for m in MONEY.findall(t))
        if expect.get("mentions_last_any"):
            rules[f"last reply mentions one of {expect['mentions_last_any']}"] = any(
                w.lower() in last.lower() for w in expect["mentions_last_any"])
        if expect.get("no_empty_link_promise"):
            rules["never 'here is a link' without a link"] = not any(
                LINK_PROMISE.search(t) and "http" not in t for t in said)
        if expect.get("last_has_question"):
            rules["last reply asks one question"] = last.count("?") == 1
        if expect.get("no_times_last"):
            rules["no times pushed at a customer who isn't interested"] = not TIME.search(last)
        return rules


def _transcript(case: dict, result: dict) -> str:
    lines = [f"[Lead form] {case.get('comments', '')}"]
    for turn in result["turns"]:
        if turn["customer"] and turn["trigger"] != "lead_created":
            lines.append(f"Customer: {turn['customer']}")
        if turn["reply"]:
            lines.append(f"AI: {turn['reply']}")
    return "\n".join(lines)


def _judge():
    from deepeval.metrics import GEval
    from deepeval.models import OpenAIModel

    model = OpenAIModel(model=os.environ.get("APPOINTMENT_JUDGE_MODEL", "gpt-4.1"),
                        api_key=get_settings().openai_api_key, temperature=0)
    # Betsy's four steps, judged one at a time (one overall impression scored the same good conversation 0.12 and
    # 0.66 on two runs - 21 Oct 2026).
    steps = [
        "CAPTURE: check the AI kept every fact the customer gave (vehicle, trade, mileage, payoff, down payment, "
        "payment target, worries) and never asked again for one already given.",
        "INTERPRET + LEVERAGE: check that once the customer has given real information, the AI's replies use THEIR "
        "facts (their trade, payoff, target, worry) as the reason the visit helps them - not a generic reason.",
        "ADVANCE: check the AI asks for the appointment with specific day/time options once it has enough to work "
        "with, and after an objection answers it and asks again - never ends with 'let me know when you're ready' "
        "or hands off to 'the team'. Repeating the same open times is fine.",
        "HONESTY: check the AI never promised approval, quoted a trade value or a payment, or invented a fact.",
        "Score high only if all four hold across the conversation; lower for each that clearly fails.",
    ]
    return GEval(name="Capture -> Interpret -> Leverage -> Advance", evaluation_steps=steps,
                 evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT], model=model, threshold=JUDGE_THRESHOLD,
                 async_mode=False)


@pytest.mark.skipif(bool(_real_models_ready()), reason=_real_models_ready() or "")
@pytest.mark.parametrize("case", CASES, ids=[c["case_id"] for c in CASES])
def test_appointment_centric(case):
    result = asyncio.run(harness.run_conversation(dict(case)))
    transcript = _transcript(case, result)
    print("\n" + transcript)
    metrics = [AppointmentRules(case, result)]
    if harness.uses_real_models() and case["expect"].get("leverage_any"):
        metrics.append(_judge())
    assert_test(LLMTestCase(input=case.get("comments", ""), actual_output=transcript), metrics, run_async=False)
