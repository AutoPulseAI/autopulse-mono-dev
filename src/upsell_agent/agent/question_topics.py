"""What a customer's question is about, in code (MASTER_PLAN_3 Phase 2 item 6).

Two separate rules that used to be one merged `restricted` regex:

- **price**: price, payments, financing, discounts, trade-in value, approval.
  Stays `restricted` for good (Phase 0 item 3).
- **stock**: whether a vehicle is in stock / available ("do you have a RAV4?").
  Still labelled `restricted` in Phase 2, because nothing answers it from
  stock yet; Phase 3 flips it to `answerable` in the same change that adds
  the answer. It is also one of `search_stock`'s triggers.

Kept apart so each can change without dragging the other along.
"""

import re

PRICE_QUESTION = re.compile(r"\b(price|cost|how much|payments?|financ\w*|apr|interest rate|discount|deal|worth|value|"
                            r"approv\w*|credit)\b", re.IGNORECASE)
STOCK_QUESTION = re.compile(r"\b(in stock|on (?:the|your) lot|available|availability|still (?:there|have|available)|"
                            r"do you (?:have|got|carry)|have any|got any|what (?:\w+ )?do you have)\b", re.IGNORECASE)


def is_price_question(text: str) -> bool:
    return bool(PRICE_QUESTION.search(text or ""))


def is_stock_question(text: str) -> bool:
    return bool(STOCK_QUESTION.search(text or ""))
