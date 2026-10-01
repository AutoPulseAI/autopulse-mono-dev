"""The shape of one turn (architecture §7), in one place.

The Debug UI draws its diagram from this (GET /dev/pipeline), so adding or
renaming a step here is the only change needed for it to appear there.

`load_context` … `guard` and `fallback` run inside the LangGraph graph. `send`
and `schedule` run in the worker after the graph returns, because the graph
never sends (architecture §7 "Key points"). `followup` is not part of a turn:
it is the 24h channel switch firing (scheduler/followups.py), which goes
straight to `send` with the message saved at schedule time.
"""

from typing import Literal, TypedDict


class PipelineNode(TypedDict):
    id: str
    label: str
    kind: Literal["code", "ai"]
    stage: int  # MASTER_PLAN_1 stage that replaces the stub with the real step
    description: str


class PipelineEdge(TypedDict):
    id: str
    source: str
    target: str
    kind: Literal["main", "retry", "fallback"]


NODES: list[PipelineNode] = [
    {"id": "load_context", "label": "Load context", "kind": "code", "stage": 7,
     "description": "Lead state, profile, recent messages, campaign"},
    {"id": "extract", "label": "Extract", "kind": "ai", "stage": 8,
     "description": "Pull slot values out of the customer's words"},
    {"id": "validate", "label": "Validate", "kind": "code", "stage": 8,
     "description": "4 checks per value: slot exists, valid, quoted, confident"},
    {"id": "search_stock", "label": "Search stock", "kind": "code", "stage": 202,
     "description": "Dealer stock from this turn's criteria, loosened step by step"},
    {"id": "decide", "label": "Decide", "kind": "code", "stage": 7,
     "description": "Pick exactly one next step from 9 rules"},
    {"id": "compose", "label": "Compose", "kind": "ai", "stage": 8,
     "description": "Write the SMS and email versions"},
    {"id": "guard", "label": "Guard", "kind": "code", "stage": 8,
     "description": "Block invented numbers, check channel format"},
    {"id": "fallback", "label": "Template reply", "kind": "code", "stage": 4,
     "description": "Safe reply when a step fails or the guard says no twice"},
    {"id": "send", "label": "Send", "kind": "code", "stage": 4,
     "description": "Idempotent send via Twilio / SendGrid"},
    {"id": "schedule", "label": "Schedule", "kind": "code", "stage": 10,
     "description": "24h follow-up on the other channel"},
    {"id": "followup", "label": "Follow-up due", "kind": "code", "stage": 10,
     "description": "24h, no reply: re-check, then resend on the other channel"},
    # MASTER_PLAN_2 Phase 2 (stage 100 + phase): not part of an AI turn either.
    {"id": "hold", "label": "Hold (lead with staff)", "kind": "code", "stage": 102,
     "description": "Customer wrote while the AI doesn't answer: holding reply or the reason why not"},
    {"id": "handoff_check", "label": "Staff check", "kind": "code", "stage": 102,
     "description": "30 business minutes after a handoff: still nobody? One more holding reply + staff alert"},
    # MASTER_PLAN_3 B1 (stage 300 + phase, 1 = B1): the after-hours morning message's checks.
    {"id": "resume", "label": "Morning message due", "kind": "code", "stage": 301,
     "description": "After-hours lead chose 'when you open': still waiting? Send check allows it? Run the turn"},
    # MASTER_PLAN_3 B4 (stage 404): the dated fresh visit offer after a 3rd decline.
    {"id": "visit_followup", "label": "Visit follow-up due", "kind": "code", "stage": 404,
     "description": "Declined 3 times, date reached: still active, no booking? Fresh offer turn"},
    {"id": "summary", "label": "Summarize older turns", "kind": "ai", "stage": 103,
     "description": "After the send: fold messages that left working memory into the lead's summary"},
]

EDGES: list[PipelineEdge] = [
    {"id": "load_context-extract", "source": "load_context", "target": "extract", "kind": "main"},
    # A new lead's first reply goes straight to the template (FIRST_REPLY_MODE=template).
    {"id": "load_context-fallback", "source": "load_context", "target": "fallback", "kind": "main"},
    # The after-hours morning message has no new customer text: no Extract (MASTER_PLAN_3 B1).
    {"id": "load_context-search_stock", "source": "load_context", "target": "search_stock", "kind": "main"},
    {"id": "resume-load_context", "source": "resume", "target": "load_context", "kind": "fallback"},
    {"id": "visit_followup-load_context", "source": "visit_followup", "target": "load_context", "kind": "fallback"},
    {"id": "extract-validate", "source": "extract", "target": "validate", "kind": "main"},
    # Extract failed (timeout, provider error, AI-call budget): template instead.
    {"id": "extract-fallback", "source": "extract", "target": "fallback", "kind": "fallback"},
    {"id": "validate-search_stock", "source": "validate", "target": "search_stock", "kind": "main"},
    {"id": "search_stock-decide", "source": "search_stock", "target": "decide", "kind": "main"},
    {"id": "decide-compose", "source": "decide", "target": "compose", "kind": "main"},
    {"id": "compose-guard", "source": "compose", "target": "guard", "kind": "main"},
    {"id": "guard-send", "source": "guard", "target": "send", "kind": "main"},
    {"id": "guard-compose", "source": "guard", "target": "compose", "kind": "retry"},
    {"id": "guard-fallback", "source": "guard", "target": "fallback", "kind": "fallback"},
    # "main": after the template step, sending is the normal path (the amber
    # guard→fallback edge already shows when it was a fallback).
    {"id": "fallback-send", "source": "fallback", "target": "send", "kind": "main"},
    {"id": "send-schedule", "source": "send", "target": "schedule", "kind": "main"},
    # The channel switch firing: no AI, the stored alternate version is sent.
    {"id": "followup-send", "source": "followup", "target": "send", "kind": "fallback"},
    {"id": "hold-send", "source": "hold", "target": "send", "kind": "fallback"},
    {"id": "handoff_check-send", "source": "handoff_check", "target": "send", "kind": "fallback"},
]

# Decide's rules, in the order they're checked (architecture §8.3, MASTER_PLAN_2 Phase 5;
# offer_visit added MASTER_PLAN_3 B4).
DECIDE_RULES: list[dict[str, str]] = [
    {"id": "stop", "label": "Customer opted out → stop"},
    {"id": "handoff", "label": "Asked for a person, clearly upset, urgent, declined 3x with a staff-only "
                              "question open, or not interested with a reason → hand off"},
    {"id": "ask_why", "label": "Not interested, no reason given → ask why, once"},
    {"id": "clarify", "label": "Asked what we meant → re-explain"},
    {"id": "answer", "label": "Questions to answer → answer, then a visit offer or a follow-up (up to two)"},
    {"id": "confirm", "label": "A value needs confirming → confirm (+ one ask)"},
    {"id": "offer_visit", "label": "A visit can be offered → offer it (+ one ask)"},
    {"id": "ask", "label": "A required detail can be asked → ask up to two"},
    {"id": "qualified", "label": "Nothing missing → qualified"},
    {"id": "partly_qualified", "label": "Everything missing asked twice → pass on what we have"},
    {"id": "acknowledge", "label": "Nothing to ask right now → reply, no question"},
]

# Validate's checks, in order (architecture §7).
VALIDATE_CHECKS: list[dict[str, str]] = [
    {"id": "slot_exists", "label": "Slot exists"},
    {"id": "value_valid", "label": "Value is valid"},
    {"id": "quote_found", "label": "Quoted words are in the message"},
    {"id": "confident", "label": "Confidence ≥ 0.7"},
]


def pipeline_definition() -> dict:
    return {"nodes": NODES, "edges": EDGES, "decide_rules": DECIDE_RULES, "validate_checks": VALIDATE_CHECKS}
