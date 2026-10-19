"""Client, 20 Oct 2026 (Bibi): a customer who texts in Spanish gets the AI's reply in Spanish, whatever wrote it
(agent/reply_language.py)."""

from upsell_agent.agent import reply_language
from upsell_agent.agent.language import customer_language


def test_only_an_english_reply_to_a_non_english_customer_is_translated():
    assert reply_language.needs_translation("Thanks, Bibi. What day works best for you to come in?", "Spanish")
    assert not reply_language.needs_translation("Gracias, Bibi. ¿Qué día le queda mejor para venir?", "Spanish")
    assert not reply_language.needs_translation("Thanks, Bibi. What day works best?", None)
    assert not reply_language.needs_translation("Thanks, Bibi. What day works best?", "English")


async def test_the_english_template_goes_out_translated(monkeypatch):
    async def fake_run(agent, model, payload, **kw):
        assert payload["language"] == "Spanish"

        class Call:
            def as_metrics(self):
                return {"model": model}
        return reply_language.Translated(text="Gracias, Bibi. ¿Qué día le queda mejor?"), Call()
    monkeypatch.setattr("upsell_agent.agent.llm.run_agent", fake_run)
    text, note = await reply_language.in_customer_language("Thanks, Bibi. What day works best for you?", "Spanish",
                                                           "openai:gpt-5-mini")
    assert text == "Gracias, Bibi. ¿Qué día le queda mejor?" and note["translated"]


async def test_a_failed_translation_never_stops_the_reply(monkeypatch):
    async def broken(*a, **kw):
        raise TimeoutError
    monkeypatch.setattr("upsell_agent.agent.llm.run_agent", broken)
    text, note = await reply_language.in_customer_language("Thanks, what day works for you?", "Spanish",
                                                           "openai:gpt-5-mini")
    assert text == "Thanks, what day works for you?" and note["translated"] is False


def test_a_spanish_text_is_seen_as_spanish():
    assert customer_language("Hola, ¿todavía tienen el carro?") == "Spanish"
    assert customer_language("ok", ["Quiero ver la camioneta el sábado"]) == "Spanish"
