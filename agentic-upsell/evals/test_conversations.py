"""Conversation evals (MASTER_PLAN_2 Phase 10): whole multi-turn conversations,
judged on how they behave, with deterministic DeepEval metrics (same answer
every run, no judge model).

Each case in datasets/conversation_cases.jsonl runs a lead and the customer's
messages through the real handlers (evals/harness.py run_conversation) and is
scored on:
- Conversation: what the case expects: a customer question is answered, the
  same detail is never asked twice in a row, short replies fill the right
  detail, "what do you mean?" is re-explained, frustration gets no handoff and
  no question, "tomorrow" gives the right date, every message gets a reply or
  a recorded reason.
- Plain replies: every reply at a reading grade of 8 or below, no internal terms.

- Default (MODEL_EXTRACT/MODEL_COMPOSE=offline): the pipeline and the offline model.
- Real models:  MODEL_EXTRACT=openai:gpt-5-mini MODEL_COMPOSE=openai:gpt-5-mini OPENAI_API_KEY=... pytest evals
"""

import asyncio
import itertools
import json
from pathlib import Path

import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase

from evals import harness
from evals.test_replies import _real_model_without_key, _Rules
from upsell_agent.guardrails.plain_language import READING_GRADE_TARGET, find_jargon, reading_grade

CASES = [json.loads(line) for line in (Path(__file__).parent / "datasets" / "conversation_cases.jsonl")
         .read_text(encoding="utf-8").splitlines() if line.strip()]


def _key(text: str) -> str:
    return " ".join("".join(ch for ch in text.lower() if ch.isalnum() or ch.isspace()).split())


class Conversation(_Rules):
    name = "Conversation"

    def rules(self) -> dict[str, bool]:
        expect, result = self.case["expect"], self.result
        replies = result["replies"]
        last = replies[-1]
        rules: dict[str, bool] = {}
        if "last_outcome_in" in expect:
            rules[f"last reply {last['outcome']!r} in {expect['last_outcome_in']}"] = last["outcome"] in expect["last_outcome_in"]
        if expect.get("answers_last_questions"):
            asked = [q["text"] for q in last["questions"]]
            answered = {_key(q) for q in (last["draft"] or {}).get("answered_questions", [])}
            rules[f"answers {asked}"] = bool(asked) and all(_key(q) in answered for q in asked)
        if "max_questions_last" in expect:
            count = last["reply"].count("?")
            rules[f"{count} question(s) in the last reply, at most {expect['max_questions_last']}"] = (
                count <= expect["max_questions_last"])
        for word in expect.get("mentions_last", []):
            rules[f"last reply mentions {word!r}"] = word.lower() in last["reply"].lower()
        if "mentions_last_any" in expect:
            rules[f"last reply mentions one of {expect['mentions_last_any']}"] = any(
                w.lower() in last["reply"].lower() for w in expect["mentions_last_any"])
        if expect.get("no_repeat_asks"):
            asked = [set(t["asked"]) for t in replies]
            repeats = [sorted(a & b) for a, b in itertools.pairwise(asked) if a & b]
            rules[f"never the same detail twice in a row {repeats}"] = not repeats
        for path, value in expect.get("slots", {}).items():
            slot = result["slots"].get(path, {})
            rules[f"{path} = {value!r} (got {slot.get('value')!r}, {slot.get('state')})"] = (
                slot.get("value") == value and slot.get("state") in ("filled", "needs_confirming"))
        if expect.get("last_asked_kept"):
            before = replies[-2]["asked"]
            rules[f"still asking about {before}"] = set(before) <= set(result["conversation"].get("last_asked", []))
        if "status" in expect:
            rules[f"lead status {result['status']!r}"] = result["status"] == expect["status"]
        if expect.get("all_answered"):
            rules[f"{result['unanswered']} message(s) without a reply or a reason"] = result["unanswered"] == 0
        # MASTER_PLAN_3 Phase 7 item 1: inventory-answering evals.
        if expect.get("vins_grounded"):
            draft, inventory = last["draft"] or {}, last["inventory"] or {}
            named = {*(draft.get("sms_vins") or []), *(draft.get("email_vins") or [])}
            loaded = {r["vin"] for r in (inventory.get("records") or [])}
            rules[f"every named vehicle {sorted(named)} was actually loaded {sorted(loaded)}"] = named <= loaded
        if "max_named_vehicles" in expect:
            draft = last["draft"] or {}
            for channel, limit in expect["max_named_vehicles"].items():
                count = len(draft.get(f"{channel}_vins") or [])
                rules[f"at most {limit} vehicle(s) named by {channel} (got {count})"] = count <= limit
        if expect.get("no_bare_no_on_no_stock"):
            draft, inventory = last["draft"] or {}, last["inventory"] or {}
            no_stock = bool(inventory.get("searched")) and not (inventory.get("records") or [])
            named = bool(draft.get("sms_vins") or draft.get("email_vins"))
            promised = bool(draft.get("promises"))
            rules["no stock found still comes with an alternative or a promise, never a bare no"] = (
                not no_stock or named or promised)
        if expect.get("no_price_mentioned"):
            rules["no price ($ sign) in the last reply"] = "$" not in last["reply"]
        return rules


class PlainReplies(_Rules):
    name = "Plain replies"

    def rules(self) -> dict[str, bool]:
        rules = {}
        for i, turn in enumerate(self.result["replies"]):
            grade = reading_grade(turn["reply"])
            rules[f"reply {i + 1}: grade {grade} <= {READING_GRADE_TARGET:g}"] = grade <= READING_GRADE_TARGET
            jargon = find_jargon(turn["reply"])
            rules[f"reply {i + 1}: no internal terms {jargon}"] = not jargon
        return rules


@pytest.mark.skipif(_real_model_without_key(), reason="real-model evals need OPENAI_API_KEY")
@pytest.mark.parametrize("case", CASES, ids=[c["case_id"] for c in CASES])
def test_conversation(case):
    result = asyncio.run(harness.run_conversation(case))
    transcript = "\n".join(f"customer: {t['customer']}\nAI ({t['outcome']}): {t['reply']}" for t in result["replies"])
    assert_test(LLMTestCase(input=json.dumps(case["messages"]), actual_output=transcript),
                [Conversation(case, result), PlainReplies(case, result)], run_async=False)
