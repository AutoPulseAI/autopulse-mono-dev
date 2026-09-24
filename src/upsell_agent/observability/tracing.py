"""Langfuse setup — every agent run should produce a trace covering every tool
call, every model call, the grounding check's pass/drop decisions, and final
output. This is what makes "why did the agent recommend X" an answerable
question instead of an archaeology exercise, and it's the audit trail a
support/compliance question about a bad recommendation needs.

TODO:
    - init_tracing(settings): configure the Langfuse client if keys are set;
      no-op (log a warning) if they're not, so local dev without Langfuse
      credentials doesn't hard-fail
    - wrap agent/graph.py's compiled graph invocation with Langfuse's
      LangGraph callback handler so every node run is captured automatically
"""

from upsell_agent.config import Settings


def init_tracing(settings: Settings) -> None:
    if not settings.langfuse_public_key or not settings.langfuse_secret_key:
        return  # local dev without observability configured — allowed, not silently pretended-to-work
    raise NotImplementedError("init_tracing: configure the Langfuse client + LangGraph callback handler")
