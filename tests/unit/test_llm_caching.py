"""GPT-5 settings, prompt caching and cached-token cost (MASTER_PLAN_4 stream G)."""

from upsell_agent.agent import llm
from upsell_agent.config import get_settings


def test_defaults_are_gpt_5_mini():
    fields = type(get_settings()).model_fields
    assert fields["model_extract"].default == "openai:gpt-5-mini"
    assert fields["model_compose"].default == "openai:gpt-5-mini"


def test_each_agent_gets_a_stable_cache_key_and_a_low_reasoning_effort():
    compose = llm.model_settings("compose", "openai:gpt-5-mini")
    extract = llm.model_settings("extract", "openai:gpt-5-mini")
    summary = llm.model_settings("summary", "openai:gpt-5-mini")
    assert compose["openai_prompt_cache_key"].endswith("-compose")
    assert extract["openai_prompt_cache_key"].endswith("-extract")
    assert summary["openai_prompt_cache_key"].endswith("-summary")
    assert compose["openai_reasoning_effort"] in ("minimal", "low")
    assert extract["openai_reasoning_effort"] in ("minimal", "low")
    # Never a sampling parameter: reasoning models reject them.
    assert not {"temperature", "top_p"} & {*compose, *extract, *summary}


def test_a_non_reasoning_model_gets_no_effort_and_offline_gets_nothing():
    assert "openai_reasoning_effort" not in llm.model_settings("compose", "openai:gpt-4o")
    assert "openai_reasoning_effort" not in llm.model_settings("compose", "openai:gpt-5-chat-latest")
    assert llm.model_settings("compose", "offline") == {}
    assert llm.reasons("openai:o4-mini") and llm.reasons("openai:gpt-5") and not llm.reasons("openai:gpt-4.1")


def test_static_instructions_carry_no_per_call_values():
    # The cache needs an identical prefix: no dates, names or braces to fill in.
    for text in (llm.EXTRACT_INSTRUCTIONS, llm.COMPOSE_INSTRUCTIONS, llm.SUMMARY_INSTRUCTIONS):
        assert "{" not in text.replace("{text, label}", "")


def test_cached_tokens_cost_the_cached_price():
    full = llm._cost("openai:gpt-5-mini", 10_000, 200)
    cached = llm._cost("openai:gpt-5-mini", 10_000, 200, tokens_cached=8_000)
    assert full == round((10_000 * 0.25 + 200 * 2.00) / 1e6, 6)
    assert cached == round((2_000 * 0.25 + 8_000 * 0.025 + 200 * 2.00) / 1e6, 6)
    assert llm._cost("offline", 1, 1) == 0.0 and llm._cost("openai:unknown", 1, 1) is None


def test_model_call_metrics_include_cached_tokens():
    call = llm.ModelCall(model="openai:gpt-5-mini", ms=10, input_tokens=100, output_tokens=5, cost_usd=0.1,
                         cached_input_tokens=64)
    assert call.as_metrics()["tokens_cached"] == 64
