"""Promptfoo provider: each test's message goes through one real turn of the
AutoPulse pipeline (evals/harness.py) and the reply the customer would get is
returned for promptfoo's assertions.

Promptfoo runs this with the Python in PROMPTFOO_PYTHON (the project's .venv,
see `make ai-evals`), so it uses whichever models are configured.
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from evals import harness


def call_api(prompt, options, context):
    variables = (context or {}).get("vars", {})
    case = {"text": prompt, "lead_type": variables.get("lead_type", "sales"),
            "channel": variables.get("channel", "sms")}
    # Planted context (MASTER_PLAN_2 Phase 10): an earlier message (in working
    # memory), a rolling summary, or text in the dealer's own record.
    if variables.get("earlier"):
        earlier = variables["earlier"]
        case["earlier"] = earlier if isinstance(earlier, list) else [earlier]
    if variables.get("summary"):
        case["summary"] = variables["summary"]
    if variables.get("dealer_store_name"):
        case["dealer_info"] = {"store_name": variables["dealer_store_name"]}
    try:
        result = asyncio.run(harness.run_case(case))
    except Exception as exc:  # noqa: BLE001 - reported as a failed test, not a crash
        return {"error": f"pipeline failed: {exc!r}"}
    return {"output": result["reply"],
            "metadata": {"outcome": result["outcome"], "used_fallback": result["used_fallback"],
                         "guard_violations": result["guard_violations"]}}
