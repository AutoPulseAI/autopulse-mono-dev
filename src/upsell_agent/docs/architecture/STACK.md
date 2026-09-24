# Stack

What this service is actually built out of, and why each piece was picked.
For the AI-specific tools (LangGraph, Pydantic AI, etc.) see
[`FRAMEWORKS.md`](FRAMEWORKS.md) — this file is everything else: language,
web layer, databases, packaging, deployment.

---

## Language & runtime

**Python 3.11+.**

Why Python and not Node (the rest of `aidmvcs-be-dev` is JavaScript): the AI
tooling this service depends on (LangGraph, Pydantic AI, DeepEval, Langfuse)
is Python-first — building this in Node would mean either weaker/less
mature equivalents or wrapping Python tools anyway. There's also an existing
precedent in this repo: `pulse/` (the website chatbot's AI engine) is already
a separate Python service alongside the Node app, so a second Python service
for AI work isn't a new pattern here.

This service is deliberately **not** a shared codebase with `aidmvcs-be-dev`
or `pulse` — it's its own process, its own dependencies, its own deploy. See
[`../../../../INTEGRATION.md`](../../../../INTEGRATION.md) for how it talks
to the rest of the platform instead of sharing code with it.

## Web / service layer

**FastAPI + Uvicorn.**

- Async by default, which matters here because almost everything this
  service does is I/O-bound (calling the model, calling Mongo, calling
  Redis, calling back into the main platform's API) — an async framework
  means those calls don't block each other unnecessarily.
- Typed request/response contracts (see [`APIS.md`](APIS.md)) using the same
  Pydantic models the rest of the service already uses — one type system for
  the whole codebase, not a separate validation layer bolted on for HTTP.
- It's a small, single-purpose internal service with exactly one real
  consumer (`aidmvcs-be-dev`) — FastAPI is deliberately the *lightest*
  reasonable choice here, not a heavier framework built for a large public
  API surface this service doesn't have.

## Data stores

**No new databases were introduced.** This service reads/writes the SAME
infrastructure the core platform already runs, on purpose — see
[`compose.yml`](../../../../../compose.yml) for the shared local infra.

| Store | Used for | Shared with |
|---|---|---|
| **MongoDB** | Long-term memory — durable conversation history, what's been shown to a customer, upsell decisions and cooldowns (see `architecture.md` §4) | Same database `aidmvcs-be-dev` uses. This service reads existing collections (Customer, Lead, Vehicle, ...) through the main platform's own API rather than querying them directly — see [`APIS.md`](APIS.md) — and owns a small set of its own collections for what only this service needs to remember. |
| **Redis** | Short-term memory — the live, in-progress state of a conversation that's still going, so a reply generated for message #6 has full context from messages #1–5 | Same Redis instance `aidmvcs-be-dev`'s background job queues already run on, but a **separate logical database index**, so this service's keys can never collide with or accidentally get wiped alongside the existing job queues. |

No SQL database, no vector database. There's no document-search/RAG
component in this design (see `architecture.md` — retrieval here means real
tool calls against real inventory/customer data, not similarity search over
embedded documents), so nothing like Postgres+pgvector or a dedicated vector
store is needed.

## Packaging & dependency management

`pyproject.toml`, built with `hatchling`. Dependencies are pinned to known
version ranges rather than left fully open — this was learned the hard way,
not assumed up front: an early check found that a loosely-pinned `langgraph`
version paired with a mismatched `langchain-core` fails at import time with a
confusing error buried deep in an unrelated module, not a clear "these don't
match" message. `langgraph` and `langgraph-checkpoint-redis` are pinned to a
verified-compatible pair for exactly this reason.

Dev-only tools (`pytest`, `ruff`, `mypy`, `DeepEval`) live in an optional
`[dev]` dependency group, not shipped in the production install.

## Deployment

A `Dockerfile` builds a standalone container (`python:3.11-slim`, installs
the package, runs `uvicorn`). It is not yet wired into
[`compose.yml`](../../../../../compose.yml) — during development it runs
directly via `uvicorn upsell_agent.main:app`. Joining `compose.yml` is a
small, later step once the service is further along, not a blocker.

## External services this stack talks to

| Service | For | Notes |
|---|---|---|
| **OpenAI** | The actual language model calls (Pydantic AI's model provider) | Not tied to a specific model — the framework choice is model-agnostic |
| **Langfuse** | Tracing every model/tool call (see [`FRAMEWORKS.md`](FRAMEWORKS.md)) | Optional locally — tracing is skipped, not faked, if not configured |

## What's deliberately NOT in this stack (yet)

- **No Kubernetes/KEDA/Ray** — this is one small service with one real
  consumer; there's no traffic today that justifies orchestration/scaling
  infrastructure. Add it when real load says to, not before.
- **No sandboxing (E2B-style)** — this service never executes
  model-generated code. That whole category of risk doesn't apply here.
- **No message queue of its own** — it reuses the Redis the platform already
  runs rather than introducing a second queueing system.
