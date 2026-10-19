"""The last step before a reply is sent: it goes out in the customer's language (client, 20 Oct 2026: Bibi texted the
AutoPulse number in Spanish from her own phone and the AI answered in English - "the AI replies to a user in the
language they asked the question in").

Compose already writes in `reply_language`, but other paths send fixed English wording: templates, the safety net,
holding replies, AI Studio's fixed messages and workflows. Here, whatever the path, a reply that is still English when
the customer writes in another language is translated by the reader model before it goes out. A failed translation
never stops the reply (the original goes out and the turn log says so).
"""

import logging
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field
from pydantic_ai import Agent

from upsell_agent.agent.language import message_language

log = logging.getLogger(__name__)

TRANSLATE_INSTRUCTIONS = """You translate a car dealership's message to a customer into the given language.
Keep the meaning, the tone and the order. Keep names, the dealership's name, addresses, phone numbers, prices,
links, vehicle names (year, make, model, trim) and stock numbers exactly as written. Write days, dates and times
the way a native speaker would. Return only the translated message in `text`, nothing else."""


class Detected(BaseModel):
    language: str | None = Field(description="The language the message is written in, by its English name "
                                             "(\"Spanish\", \"Urdu\"). Null when it is too short to tell.")


DETECT_INSTRUCTIONS = """Name the language a customer's text message is written in, by its English name. Null when
the message has no words to go on (a number, "ok", an emoji)."""


@lru_cache
def detect_agent(model_name: str) -> Agent[None, Detected]:
    from upsell_agent.agent.llm import _model
    return Agent(_model(model_name), output_type=Detected, instructions=DETECT_INSTRUCTIONS,
                 name="detect_language", defer_model_check=True, retries=1)


async def detect(text: str, model_name: str, *, timeout_s: float = 15.0) -> str | None:
    """The language of a message the AI doesn't answer (held while a person handles the lead), so the next message
    to the customer - from the AI or typed by staff - is in it. The plain word check first; the reader model when it
    can't tell. None when nothing can be told."""
    from upsell_agent.agent.language import message_language as by_words
    from upsell_agent.agent.llm import OFFLINE, run_agent
    found = by_words(text)
    if found or model_name == OFFLINE or len(str(text or "").split()) < 2:
        return found
    try:
        out, _ = await run_agent(detect_agent(model_name), model_name, {"message": text}, timeout_s=timeout_s,
                                 output_tokens_limit=50)
    except Exception as exc:
        log.warning("language detection failed: %r", exc)
        return None
    return str(out.language or "").strip().title() or None


class Translated(BaseModel):
    text: str = Field(description="The message, translated.")


@lru_cache
def translate_agent(model_name: str) -> Agent[None, Translated]:
    from upsell_agent.agent.llm import _model
    return Agent(_model(model_name), output_type=Translated, instructions=TRANSLATE_INSTRUCTIONS,
                 name="translate", defer_model_check=True, retries=1)


def needs_translation(text: str | None, language: str | None) -> bool:
    """True when the customer writes in `language` (not English) and `text` reads as English."""
    return bool(text and language and language != "English" and message_language(text) == "English")


async def in_customer_language(text: str | None, language: str | None, model_name: str, *,
                               timeout_s: float = 20.0) -> tuple[str | None, dict[str, Any] | None]:
    """(text to send, note for the turn log). The note is None when nothing needed translating."""
    if not needs_translation(text, language):
        return text, None
    from upsell_agent.agent.llm import OFFLINE, run_agent
    if model_name == OFFLINE:
        return text, {"language": language, "translated": False, "reason": "offline model"}
    try:
        out, call = await run_agent(translate_agent(model_name), model_name, {"language": language, "message": text},
                                    timeout_s=timeout_s, output_tokens_limit=800)
    except Exception as exc:  # never lose the reply over a translation
        log.warning("translation to %s failed: %r", language, exc)
        return text, {"language": language, "translated": False, "reason": repr(exc)}
    translated = (out.text or "").strip()
    if not translated:
        return text, {"language": language, "translated": False, "reason": "empty translation"}
    return translated, {"language": language, "translated": True, "original": text, **call.as_metrics()}
