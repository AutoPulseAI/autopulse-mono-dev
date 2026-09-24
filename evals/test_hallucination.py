"""Pre-deploy quality gate. This must pass before any change to agent/prompts.py,
agent/nodes/recommend.py, or the model version ships — see README.md.

Each case in datasets/upsell_hallucination_cases.jsonl gets its own assertion
here once the agent graph is implemented. Do not merge new cases into the
dataset without a corresponding test — an untested dataset entry gives false
confidence.

TODO: replace with real DeepEval test cases once agent/graph.py is wired up.
Shape (once implemented):

    from deepeval import assert_test
    from deepeval.metrics import GEval
    from deepeval.test_case import LLMTestCase

    async def test_declined_warranty_not_reoffered():
        result = await run_agent(dealer_id=..., customer_id=..., trigger="service_visit_closed")
        assert not any(r.item_type == "extended_warranty" for r in result.recommendations)

    # + a GEval-based faithfulness metric checking `reasoning` against the
    # actual tool_call results, for cases where a purely structural assert
    # isn't enough.
"""

import json
from pathlib import Path

DATASET_PATH = Path(__file__).parent / "datasets" / "upsell_hallucination_cases.jsonl"


def test_dataset_is_loadable():
    """Sanity check only — confirms the eval dataset itself is well-formed.
    Not a substitute for the real per-case tests once the agent exists.
    """
    cases = [json.loads(line) for line in DATASET_PATH.read_text().splitlines() if line.strip()]
    assert len(cases) > 0
    for case in cases:
        assert "case_id" in case
        assert "expected" in case
