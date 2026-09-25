"""Extraction evals (MASTER_PLAN_1 Stage 8 "done when": the DeepEval
extraction tests pass).

Runs the real Extract agent (agent/llm.py) against the configured
MODEL_EXTRACT on a fixed dataset, and scores each case with a DeepEval
metric: slot-level F1 between what was extracted (after the same Validate
checks the pipeline applies) and what the customer actually said. No judge
model is needed, so the score is deterministic for a given extractor.

- Default (MODEL_EXTRACT=offline): checks the offline model's rules.
- With a real model:  MODEL_EXTRACT=openai:gpt-4o-mini OPENAI_API_KEY=... pytest evals/test_extraction.py
  Skipped automatically when the key is missing.
"""

import asyncio
import json
import os
from pathlib import Path

os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
os.environ.setdefault("MODEL_EXTRACT", "offline")

import pytest  # noqa: E402
from deepeval import assert_test  # noqa: E402
from deepeval.metrics import BaseMetric  # noqa: E402
from deepeval.test_case import LLMTestCase  # noqa: E402

from upsell_agent.agent.llm import OFFLINE, extract_agent, run_agent  # noqa: E402
from upsell_agent.agent.nodes.extract import _allowed_slots  # noqa: E402
from upsell_agent.agent.nodes.validate import run_checks  # noqa: E402
from upsell_agent.config import get_settings  # noqa: E402

CASES = [json.loads(line) for line in (Path(__file__).parent / "datasets" / "extraction_cases.jsonl")
         .read_text(encoding="utf-8").splitlines() if line.strip()]
THRESHOLD = 0.9
MODEL = os.environ["MODEL_EXTRACT"]


class SlotF1(BaseMetric):
    """F1 over (slot, value) pairs: extracted-and-accepted vs expected."""

    def __init__(self, expected: dict, extracted: dict, threshold: float = THRESHOLD):
        self.expected, self.extracted, self.threshold = expected, extracted, threshold

    def measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        expected = set(self.expected.items())
        got = set(self.extracted.items())
        if not expected and not got:
            self.score = 1.0
        else:
            hits = len(expected & got)
            precision = hits / len(got) if got else 0.0
            recall = hits / len(expected) if expected else 0.0
            self.score = 0.0 if hits == 0 else 2 * precision * recall / (precision + recall)
        self.success = self.score >= self.threshold
        self.reason = (f"missing {sorted(expected - got)}; unexpected {sorted(got - expected)}"
                       if not self.success else "all slots match")
        return self.score

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return bool(self.success)

    @property
    def __name__(self):
        return "Slot F1"


def _extract(case: dict) -> dict:
    payload = {"customer_text": case["text"], "lead_type": case["lead_type"], "allowed_slots": _allowed_slots(),
               "recently_asked": []}
    result, _ = asyncio.run(run_agent(extract_agent(MODEL), MODEL, payload, timeout_s=20, output_tokens_limit=500))
    accepted = {}
    for value in result.model_dump()["values"]:
        checked = run_checks(value, case["text"])
        if all(checked["checks"][k] for k in ("slot_exists", "value_valid", "quote_found")):
            accepted[value["path"]] = checked["value"]
    return accepted


@pytest.mark.skipif(MODEL != OFFLINE and not get_settings().openai_api_key.startswith("sk-"),
                    reason="real-model evals need OPENAI_API_KEY")
@pytest.mark.parametrize("case", CASES, ids=[c["case_id"] for c in CASES])
def test_extraction(case):
    extracted = _extract(case)
    test_case = LLMTestCase(input=case["text"], actual_output=json.dumps(extracted, default=str))
    assert_test(test_case, [SlotF1(case["expected"], extracted)])
