"""Stream G's grammar judge (evals/test_grammar.py: DeepEval G-Eval, grammar, spelling and punctuation only)
as a function evals/conversation_cost.py can call on a whole conversation (`--grammar judge`; PLAN_4 stream Q).

    judge_conversation(replies) -> {"score": mean 0-1, "issues": [reason for each reply under the threshold]}

Each reply is judged on its own by GRAMMAR_JUDGE_MODEL (default gpt-4.1-mini). The judge's own tokens are not
in the harness's cost numbers (they are a measurement, not part of the product): roughly $0.0003 a reply.
"""

from typing import Any


def judge_conversation(replies: list[str]) -> dict[str, Any]:
    from deepeval.test_case import LLMTestCase

    from evals.test_grammar import THRESHOLD, _judge

    scores, issues = [], []
    for reply in replies:
        if not reply.strip():
            continue
        metric = _judge()
        metric.measure(LLMTestCase(input="(customer message)", actual_output=reply))
        scores.append(float(metric.score or 0.0))
        if (metric.score or 0.0) < THRESHOLD:
            issues.append(f"{metric.score:.2f}: {reply[:120]!r} - {metric.reason}")
    return {"score": round(sum(scores) / len(scores), 3) if scores else None, "issues": issues}
