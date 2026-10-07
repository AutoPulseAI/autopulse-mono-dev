"""Grammar eval (MASTER_PLAN_4 stream G; client, 5 Oct 2026: "the AI was using very bad grammar. Not the
context - it asks the right questions and deals with the right people - but the grammar was bad").

What the customer would receive (evals/harness.py, the whole pipeline) is scored by an LLM judge
(DeepEval G-Eval) on grammar, spelling and punctuation ONLY - never on content, which evals/test_replies.py
judges. Alongside it, the guard's own mechanical rule (guardrails/grammar.py) must hold on the sent text.

- Default (MODEL_EXTRACT/MODEL_COMPOSE=offline): skipped. A judge model is needed, and the offline model's
  fixed sentences are covered by tests/unit/test_grammar_guard.py instead.
- Real models:
    MODEL_EXTRACT=openai:gpt-5-mini MODEL_COMPOSE=openai:gpt-5-mini OPENAI_API_KEY=... pytest evals/test_grammar.py
  The judge is GRAMMAR_JUDGE_MODEL (default gpt-4.1-mini: G-Eval reads token log-probabilities, which
  reasoning models don't return). Pass mark: GRAMMAR_THRESHOLD (default 0.8 of 1).
"""

import asyncio
import json
import os
from pathlib import Path

import pytest
from deepeval import assert_test
from deepeval.test_case import LLMTestCase, SingleTurnParams

from evals import harness
from evals.test_replies import _Rules
from upsell_agent.agent.nodes.guard import mandated_wording
from upsell_agent.config import get_settings
from upsell_agent.guardrails.grammar import grammar_problems

JUDGE_MODEL = os.environ.get("GRAMMAR_JUDGE_MODEL", "gpt-4.1-mini")
THRESHOLD = float(os.environ.get("GRAMMAR_THRESHOLD", "0.8"))

# A spread of first replies, follow-ups, a question, an email and the injection / urgent cases, where the
# model writes the most freely.
CASE_IDS = ["first-reply-sales", "sales-budget-given", "trade-in-details", "service-brakes", "email-lead",
            "price-question", "urgent-no-transportation", "eager-not-urgent-keep-talking",
            "injection-ignore-rules-price"]
ALL = {c["case_id"]: c for c in (json.loads(line) for line in (Path(__file__).parent / "datasets" /
                                 "reply_cases.jsonl").read_text(encoding="utf-8").splitlines() if line.strip())}
CASES = [ALL[i] for i in CASE_IDS if i in ALL]

CRITERIA = (
    "Judge ONLY the grammar, spelling and punctuation of the actual output, a car dealership's text message or "
    "email to a customer, against natural, correct American English. Ignore what it says, whether it is "
    "helpful, its tone and its length. Penalize: sentence fragments that read as broken (a friendly short "
    "'Thanks!' or 'Got it.' is fine), run-on sentences and comma splices, subject-verb disagreement, wrong or "
    "missing articles, misspellings, British spellings, missing or wrong capitalization, missing or misplaced "
    "punctuation (including a missing final period or question mark), doubled words and awkward, "
    "ungrammatical phrasing. Contractions and a plain dash used as a pause are fine. A score of 1 means a "
    "careful professional editor would change nothing.")


def _judge():
    from deepeval.metrics import GEval
    from deepeval.models import OpenAIModel

    model = OpenAIModel(model=JUDGE_MODEL, api_key=get_settings().openai_api_key, temperature=0)
    return GEval(name="Grammar", criteria=CRITERIA, evaluation_params=[SingleTurnParams.ACTUAL_OUTPUT],
                 model=model, threshold=THRESHOLD, async_mode=False)


class MechanicalGrammar(_Rules):
    name = "Mechanical grammar (the guard's rule)"

    def rules(self) -> dict[str, bool]:
        exempt = mandated_wording(self.result.get("decision") or {})
        problems = grammar_problems(self.result["reply"], exempt=exempt,
                                    needs_final_punctuation=self.case.get("channel", "sms") == "sms")
        return {"no mechanical grammar mistake" + (f" ({'; '.join(problems)})" if problems else ""): not problems}


def _skip_reason() -> str | None:
    if not harness.uses_real_models():
        return "grammar eval judges real-model replies (set MODEL_EXTRACT / MODEL_COMPOSE to openai:...)"
    if not get_settings().openai_api_key.startswith("sk-"):
        return "grammar eval needs OPENAI_API_KEY"
    return None


@pytest.mark.skipif(_skip_reason() is not None, reason=_skip_reason() or "")
@pytest.mark.parametrize("case", CASES, ids=[c["case_id"] for c in CASES])
def test_grammar(case):
    result = asyncio.run(harness.run_case(case))
    assert result["reply"], "no reply was sent"
    assert_test(LLMTestCase(input=case["text"], actual_output=result["reply"]),
                [MechanicalGrammar(case, result), _judge()], run_async=False)


def test_grammar_eval_is_offline_safe():
    """The default gate never calls a judge: the real-model cases above are skipped offline."""
    assert CASES and (harness.uses_real_models() or _skip_reason() is not None)
