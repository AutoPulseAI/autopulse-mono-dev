"""The send check (MASTER_PLAN_3 C1, with B2 and B3 folded in).

One deterministic engine decides whether a message may go out: `can_contact`
in compliance/engine.py returns ALLOW, HOLD <until>, REVIEW <reason> or
BLOCK <reason>, and records every decision in an add-only log. The model is
never asked whether a message is allowed, and can never make one allowed.
"""
