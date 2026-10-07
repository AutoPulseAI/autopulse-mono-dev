# AutoPulse Agentic Upsell Layer

A standalone Python service that reasons about **what to upsell, to whom, and when** — grounded in real
inventory/pricing/customer data, with durable memory across a customer's lifecycle, and hard guardrails
against recommending anything that isn't real.

This is a **separate service**, not a rewrite of the existing platform. It plugs in alongside
`aidmvcs-be-dev` (the core Next.js app) and the existing n8n workflows, which continue to handle
first-response email/SMS replies unchanged. See [`../docs/architecture/architecture.md`](../docs/architecture/architecture.md)
for how this fits into the wider system, and [`INTEGRATION.md`](INTEGRATION.md) for the wiring details.

## Why this exists (and why it's not built in n8n)

Upselling touches money and compliance. It needs three things n8n structurally cannot give it:

1. **Durable, multi-step state** — an upsell decision isn't one webhook call, it's a sequence that can span
   weeks ("declined the warranty in March, came back for service in June, mileage now justifies a different
   pitch"). That needs a checkpointed state machine, not a stateless workflow trigger.
2. **Typed, validated, grounded output** — a recommendation must reference a real product/price that was
   actually returned by a tool call. Never generated from the model's "memory."
3. **Evals and tracing before anything ships** — every prompt/model change is regression-tested against a
   hallucination test suite before deploy, and every live decision is traceable back to the data that
   justified it.

## Stack

| Concern | Choice | Why |
|---|---|---|
| Agent orchestration + durable memory/state | **LangGraph** | Checkpointed state machine — the agent can pause after "declined" and resume correctly weeks later |
| Typed, validated model output | **Pydantic AI** | The model's recommendation is forced into a schema; invalid/ungrounded output is rejected before it reaches a customer |
| Tool calling | Native function tools (no MCP yet — see [architecture.md](../docs/architecture/architecture.md) discussion; this is a single-consumer agent, MCP is unjustified overhead until a second client needs the same tools) | |
| API layer | **FastAPI** | Async, typed, plugs into the existing Redis/Mongo the core platform already runs |
| Short/long-term memory store | Redis (session/checkpoint) + MongoDB (customer preference profile, reusing the **same** database as `aidmvcs-be-dev`) | No new datastore to operate |
| Anti-hallucination | Retrieval-before-claim pattern + Pydantic schema validation + a grounding-verification node | See `agent/nodes/verify_grounding.py` |
| Evals (pre-deploy gate) | **DeepEval** | `evals/test_hallucination.py` — must pass in CI before a prompt/model change ships |
| Observability | **Langfuse** | Per-conversation trace: which tools were called, what data grounded the recommendation, cost, latency |

## Project layout

```
agentic-upsell/
├── src/upsell_agent/
│   ├── main.py                  # FastAPI app entrypoint
│   ├── config.py                # Settings (env vars), shared across the service
│   ├── api/                     # HTTP contract
│   │   ├── schemas.py           #   request/response Pydantic models
│   │   └── routes.py            #   POST /upsell/recommend, /upsell/feedback, etc.
│   ├── agent/                   # The LangGraph agent itself
│   │   ├── state.py             #   typed graph state
│   │   ├── graph.py             #   node/edge wiring, checkpointer setup
│   │   ├── prompts.py           #   prompt templates (versioned, reviewed like code)
│   │   └── nodes/                #   one file per graph node (see below)
│   ├── tools/                   # What the agent is allowed to call — the ONLY source of facts
│   │   ├── inventory_tool.py    #   real vehicle inventory (reads same Mongo as aidmvcs-be-dev)
│   │   ├── pricing_tool.py      #   real pricing/promotions/finance offers
│   │   └── customer_tool.py     #   Customer 360 — purchase/service history, prior upsell responses
│   ├── memory/                  # Explicit, inspectable memory — not "stuff it in the prompt"
│   │   ├── short_term.py        #   LangGraph checkpointer (this conversation/session)
│   │   ├── long_term.py         #   per-customer upsell profile (declined X, responds to Y, cadence)
│   │   └── models.py            #   Pydantic models for both
│   ├── guardrails/
│   │   ├── output_validation.py #   rejects any claim not backed by a tool result
│   │   └── policy.py            #   business/compliance rules (quiet hours, re-offer cooldown, opt-outs)
│   ├── integrations/            # Talking to the rest of AutoPulse
│   │   ├── mongodb.py           #   same MongoDB instance/DB as aidmvcs-be-dev
│   │   ├── redis_client.py      #   same Redis instance aidmvcs-be-dev already runs
│   │   └── autopulse_api_client.py  # calls the existing Next.js API instead of duplicating logic
│   └── observability/
│       └── tracing.py           #   Langfuse setup
├── evals/                       # Pre-deploy quality gate — not optional
│   ├── datasets/upsell_hallucination_cases.jsonl
│   └── test_hallucination.py
└── tests/                       # Unit + integration tests
```

### The agent graph (`agent/nodes/`)

```
retrieve_context  →  recommend  →  verify_grounding  →  respond
     │                                    │
     └─ pulls customer profile,           └─ fails closed: if a claim in the
        inventory, pricing, prior            recommendation isn't backed by a
        upsell history via tools/            tool result, it's rejected and
                                              re-generated or escalated to staff,
                                              never sent as-is
```

Every node reads/writes the typed `AgentState` (see `agent/state.py`), and the graph is checkpointed
(`agent/graph.py`) so a run can be resumed days later with full context — this is what makes the
multi-week "declined once, revisit later" upsell pattern possible.

## Getting started

```bash
cd agentic-upsell
python -m venv .venv && source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -e ".[dev]"
cp .env.example .env    # fill in OPENAI_API_KEY, MONGODB_URI, REDIS_URL, LANGFUSE_* (see below)
uvicorn upsell_agent.main:app --reload --port 8100
```

Run the eval gate before you ship any prompt/logic change:

```bash
pytest evals/ -v
```

## Environment

See [`.env.example`](.env.example). Notably `MONGODB_URI` and `REDIS_URL` should point at the **same**
MongoDB/Redis the core platform (`aidmvcs-be-dev`) already uses locally (`compose.yml` at the repo root) —
this service reads Customer/Lead/Vehicle data, it does not duplicate it.

## Status

| Layer | Status |
|---|---|
| Auth (Next.js ↔ this service, both directions) | **Real, tested.** See [`INTEGRATION.md`](INTEGRATION.md). |
| `guardrails/never_invent.py` (the core anti-hallucination check) | **Real, tested** — 7 passing tests against real conversations.md scenarios. |
| `memory/long_term.py` (Mongo — cross-conversation profile + cooldown policy) | **Real**, not yet tested against a live Mongo instance. |
| `memory/short_term.py` (Redis — LangGraph checkpointer) | **Real**, API verified against the actual installed package; not yet exercised end-to-end. |
| `agent/qualification.py` + `agent/state.py` (the conversations.md data model) | **Real, tested** — 5 passing tests, including the fact-merge-across-turns property. |
| `guardrails/output_validation.py` (single-shot recommendation grounding) | Stub |
| `agent/nodes/*.py` (CAPTURE/INTERPRET/LEVERAGE/ADVANCE graph logic) | Stub — this is the next piece: wiring Pydantic AI calls into each node |
| `tools/pricing_tool.py` | Blocked on a product decision (no pricing/promotions data model exists yet — see the conversations.md analysis in project history) |
| Node.js cutover (`emailWorker.js` et al. calling this service instead of n8n) | Not started — see [`docs/N8N_CUTOVER_PLAN.md`](docs/N8N_CUTOVER_PLAN.md) for the planned sequencing and why it comes last |

See [`INTEGRATION.md`](INTEGRATION.md) for the auth chain and dealer-portal wiring, and
[`docs/N8N_CUTOVER_PLAN.md`](docs/N8N_CUTOVER_PLAN.md) for the n8n replacement plan.
