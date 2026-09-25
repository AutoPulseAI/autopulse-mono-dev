"""Extraction evals (MASTER_PLAN_1 Stage 8 "done when": the DeepEval
extraction tests pass).

Runs the real Extract agent (agent/llm.py) against the configured
MODEL_EXTRACT on a fixed dataset, and scores each case with a DeepEval
metric: slot-level F1 between what was extracted (after the same Validate
checks the pipeline applies) and what the customer actually said. No judge
model is needed, so the score is deterministic for a given extractor.

Understanding (MASTER_PLAN_2 Phase 4): cases can also give what we last asked
(`recently_asked`, `last_ai`) and expect question labels and the
handoff / frustration signals, scored by the Understanding metric.

- Default (MODEL_EXTRACT=offline): checks the offline model's rules.
- With a real model:  MODEL_EXTRACT=openai:gpt-4o-mini OPENAI_API_KEY=... pytest evals/test_extraction.py
  Skipped automatically when the key is missing.
"""

import asyncio
import json
import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.setdefault("DEEPEVAL_TELEMETRY_OPT_OUT", "YES")
os.environ.setdefault("MODEL_EXTRACT", "offline")

import pytest  # noqa: E402
from deepeval import assert_test  # noqa: E402
from deepeval.metrics import BaseMetric  # noqa: E402
from deepeval.test_case import LLMTestCase  # noqa: E402

from upsell_agent.agent.llm import OFFLINE, extract_agent, run_agent  # noqa: E402
from upsell_agent.agent.nodes.extract import _allowed_slots  # noqa: E402
from upsell_agent.agent.nodes.validate import resolve_dates, run_checks  # noqa: E402
from upsell_agent.config import get_settings  # noqa: E402

CASES = [json.loads(line) for line in (Path(__file__).parent / "datasets" / "extraction_cases.jsonl")
         .read_text(encoding="utf-8").splitlines() if line.strip()]
THRESHOLD = 0.9
EVAL_NOW = datetime(2026, 9, 22, 10, 0, tzinfo=ZoneInfo("America/New_York"))
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


def _extract(case: dict) -> tuple[dict, dict]:
    last_ai = case.get("last_ai")
    payload = {"customer_text": case["text"], "lead_type": case["lead_type"], "allowed_slots": _allowed_slots(),
               "recently_asked": case.get("recently_asked", []),
               "context": {"working_memory": [{"direction": "outbound", "channel": "sms", "text": last_ai}]
                           if last_ai else [], "conversation": {"last_asked": case.get("recently_asked", [])}}}
    result, _ = asyncio.run(run_agent(extract_agent(MODEL), MODEL, payload, timeout_s=20, output_tokens_limit=500))
    raw = result.model_dump()
    # Dates come back as the customer's words; code works them out (MASTER_PLAN_2 Phase 8),
    # here against a fixed "now": Tuesday September 22, 2026, 10:00 in New York.
    values, _ = resolve_dates(raw["values"], EVAL_NOW, timeline_known=True, reasoning=[])
    accepted = {}
    for value in values:
        checked = run_checks(value, case["text"])
        if all(checked["checks"][k] for k in ("slot_exists", "value_valid", "quote_found")):
            accepted[value["path"]] = checked["value"]
    return accepted, raw


class Understanding(BaseMetric):
    """Question labels and the handoff / frustration signals, all or nothing."""

    threshold = 1.0

    def __init__(self, case: dict, raw: dict):
        self.case, self.raw = case, raw

    def measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        problems = []
        if "expected_labels" in self.case:
            labels = sorted(q["label"] for q in self.raw["questions"])
            if labels != sorted(self.case["expected_labels"]):
                problems.append(f"labels {labels} != {sorted(self.case['expected_labels'])}")
        flags = self.case.get("expected_flags", {})
        handoff = self.raw["wants_human"] or (self.raw["upset"] and self.raw["upset_confidence"] >= 0.8)
        if "handoff" in flags and handoff != flags["handoff"]:
            problems.append(f"handoff signal {handoff}, expected {flags['handoff']}")
        if "annoyed_at_bot" in flags and self.raw["annoyed_at_bot"] != flags["annoyed_at_bot"]:
            problems.append(f"annoyed_at_bot {self.raw['annoyed_at_bot']}, expected {flags['annoyed_at_bot']}")
        self.score = 0.0 if problems else 1.0
        self.success = not problems
        self.reason = "; ".join(problems) or "understood"
        return self.score

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs) -> float:
        return self.measure(test_case)

    def is_successful(self) -> bool:
        return bool(self.success)

    @property
    def __name__(self):
        return "Understanding"


@pytest.mark.skipif(MODEL != OFFLINE and not get_settings().openai_api_key.startswith("sk-"),
                    reason="real-model evals need OPENAI_API_KEY")
@pytest.mark.parametrize("case", CASES, ids=[c["case_id"] for c in CASES])
def test_extraction(case):
    extracted, raw = _extract(case)
    test_case = LLMTestCase(input=case["text"], actual_output=json.dumps(extracted, default=str))
    metrics = [SlotF1(case["expected"], extracted)]
    if "expected_labels" in case or "expected_flags" in case:
        metrics.append(Understanding(case, raw))
    assert_test(test_case, metrics)
