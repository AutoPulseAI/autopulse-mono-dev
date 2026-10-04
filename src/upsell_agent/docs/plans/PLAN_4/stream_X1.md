# PLAN_4 stream X1: compliance fixes from audit 2 (TCPA guardrails)

Source: the independent audit of the build against the client's TCPA PDF (`audit_2_tcpa.md`), the PDF itself,
`docs/data/6/tcpa_7.md` and the client's answers in `docs/data/6/conversation_6.md` (Q10, Q19).
Every item has a regression test that failed before its fix.

## Item 2: explicit opt-outs caught in code

`compliance/opt_out.py`. A short message (6 words or fewer) that only says stop, with politeness or emphasis
around it ("please stop", "STOP ALL", "unsubscribe please", "I said stop", "ok stop now", "STOP. Thanks"), is an
opt-out of every channel (the customer didn't limit it) with our one confirmation. A bare keyword ("STOP", "END.",
"Stop!!! 🛑") is still the carrier keyword on its own channel. New phrases at any length: "stop calling" → calls,
"stop texting" / "stop sending texts" / "dont txt me" / "I don't want any more texts" → texts, "stop emailing" /
"stop sending emails" → email, "stop sending me messages", "opt me out", "remove me", "take me off", "do not
contact", Spanish "no más mensajes" → every channel. Normalisation drops accents, emojis and punctuation.
"Don't stop texting me", "stop by", "stop in at 3", "the car won't stop pulling left", "cancel my appointment",
"opt out of the extended warranty" are not opt-outs; "I'm not interested" is still an objection. Anything unclear
still goes to the model's `possible_opt_out` → REVIEW.

Tests: `tests/unit/test_x1_opt_out_detection.py` (table of positives and negatives; 35 failed before).
