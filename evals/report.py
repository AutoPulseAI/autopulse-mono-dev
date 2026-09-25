"""Eval run report (MASTER_PLAN_2 Phase 10): every reply case and conversation
case through the configured models, with pass rates, template fallbacks, how
often the guard accepted the first draft, reply time and cost per reply.

    python -m evals.report                      # offline model
    MODEL_EXTRACT=openai:gpt-4o-mini MODEL_COMPOSE=openai:gpt-4o OPENAI_API_KEY=... python -m evals.report

Writes evals/reports/<date>-<models>.json and prints a summary. The pass/fail
rules are the same metrics the eval gate uses (test_replies.py,
test_conversations.py).
"""

import asyncio
import json
import statistics
import sys
from datetime import UTC, datetime
from pathlib import Path

from evals import harness
from evals.test_conversations import CASES as CONVERSATION_CASES
from evals.test_conversations import Conversation, PlainReplies
from evals.test_replies import CASES as REPLY_CASES
from evals.test_replies import PlainReply, RightBehaviour, SafeReply
from upsell_agent.config import get_settings

REPORTS = Path(__file__).parent / "reports"


async def _models_answer(settings) -> str | None:
    """One tiny call per real model before the run, so a bad key or model name
    is reported plainly instead of as every case falling back to the template."""
    from upsell_agent.agent.llm import OFFLINE, extract_agent, run_agent

    for model in {settings.model_extract, settings.model_compose} - {OFFLINE}:
        try:
            await run_agent(extract_agent(model), model, {"customer_text": "used", "lead_type": "sales",
                                                          "allowed_slots": [], "recently_asked": []},
                            timeout_s=30, output_tokens_limit=200)
        except Exception as exc:  # noqa: BLE001 - reported, not raised
            return f"{model}: {type(exc).__name__}: {str(exc)[:300]}"
    return None


def _broken(metrics) -> list[str]:
    return [f"{m.name}: {name}" for m in metrics for name, ok in m.rules().items() if not ok]


async def main() -> int:
    settings = get_settings()
    models = f"{settings.model_extract} / {settings.model_compose}"
    if problem := await _models_answer(settings):
        print("The models can't be reached, so nothing was run.")
        print(f"  {problem}")
        print("Check OPENAI_API_KEY in agentic-upsell/.env (and that the key's organization is active).")
        return 2
    rows, turns = [], []
    for case in REPLY_CASES:
        result = await harness.run_case(case)
        broken = _broken([SafeReply(case, result), RightBehaviour(case, result), PlainReply(case, result)])
        rows.append({"kind": "reply", "case": case["case_id"], "passed": not broken, "broken": broken,
                     "reply": result["reply"]})
        turns.append(result)
        print(f"{'PASS' if not broken else 'FAIL'}  reply  {case['case_id']}", flush=True)
    for case in CONVERSATION_CASES:
        result = await harness.run_conversation(case)
        broken = _broken([Conversation(case, result), PlainReplies(case, result)])
        rows.append({"kind": "conversation", "case": case["case_id"], "passed": not broken, "broken": broken,
                     "transcript": [{"customer": t["customer"], "ai": t["reply"], "outcome": t["outcome"]}
                                    for t in result["replies"]]})
        turns += result["replies"]
        print(f"{'PASS' if not broken else 'FAIL'}  conversation  {case['case_id']}", flush=True)

    ms = [t["ms"] for t in turns if t.get("ms") is not None]
    cost = sum(t["cost_usd"] for t in turns)
    summary = {
        "models": models, "run_at": datetime.now(UTC).isoformat(),
        "cases": len(rows), "passed": sum(r["passed"] for r in rows),
        "turns": len(turns),
        "template_fallbacks": sum(t["used_fallback"] for t in turns),
        "guard_first_draft_rate": round(sum(t["guard_passed_first_time"] for t in turns) / len(turns), 3),
        "reply_ms": {"p50": statistics.median(ms) if ms else None,
                     "p95": sorted(ms)[max(0, round(0.95 * (len(ms) - 1)))] if ms else None},
        "cost_usd": {"total": round(cost, 5), "per_reply": round(cost / len(turns), 6) if turns else None},
    }
    REPORTS.mkdir(exist_ok=True)
    name = f"{datetime.now(UTC):%Y%m%d-%H%M}-{settings.model_extract}-{settings.model_compose}".replace(":", "_")
    (REPORTS / f"{name}.json").write_text(json.dumps({"summary": summary, "cases": rows}, indent=1), encoding="utf-8")

    print(f"\nModels: {models}")
    print(f"Cases:  {summary['passed']}/{summary['cases']} passed")
    print(f"Turns:  {summary['turns']}, template fallbacks {summary['template_fallbacks']}, "
          f"guard accepted the first draft {summary['guard_first_draft_rate']:.0%}")
    print(f"Time:   p50 {summary['reply_ms']['p50']} ms, p95 {summary['reply_ms']['p95']} ms per turn")
    print(f"Cost:   ${summary['cost_usd']['total']:.4f} total, ${summary['cost_usd']['per_reply'] or 0:.5f} per reply")
    for row in rows:
        if not row["passed"]:
            print(f"  FAIL {row['kind']} {row['case']}: {'; '.join(row['broken'])}")
    print(f"Report: evals/reports/{name}.json")
    return 0 if summary["passed"] == summary["cases"] else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
