# Team Split — 3 Developers, No File Overlap

Three people, three plans, split along the codebase's own boundaries — not by
task, by **which directory each person is the only one touching**. That's
what makes this conflict-free: two people can work at the same time, every
day, and never produce a merge conflict on the same file, because they're
never in the same file.

| Developer | Plan | Owns (and only touches) |
|---|---|---|
| **Frontend engineer** | [`FRONTEND/FPLAN_1.md`](FRONTEND/FPLAN_1.md) | `aidmvcs-be-dev/app/dealer/**` — every dealer-portal page and component |
| **Backend developer** | [`BACKEND/BPLAN_1.md`](BACKEND/BPLAN_1.md) | `aidmvcs-be-dev/app/api/**` (the routes that call the AI service) and small, targeted additions to existing platform logic (booking, follow-ups, the worker files) |
| **AI developer** | [`AI/PLAN_1.md`](AI/PLAN_1.md) | `agentic-upsell/**` — the Python service itself, entirely |

Three separate codebases, three separate people. The frontend engineer never opens a Python
file. The AI developer never opens a `.js` file. The backend developer never
opens `app/dealer/`. That's the whole trick — there is no shared file where
two people's changes can land on the same line.

---

## Why this split, not a different one

An earlier draft of this considered splitting the AI developer's work in two
(one person on memory/tools, one on the reasoning/safety pipeline) to use
two people on the Python service. That's a **worse** split for a 3-person
team: those two people would both be editing `agent/state.py`,
`agent/graph.py`, and `api/routes.py` constantly, which is exactly the kind
of shared-file conflict this document exists to avoid. One person owning the
whole Python service, working through `AI/PLAN_1.md`'s phases in order, has
zero of that risk. If a fourth developer joins later, split the *frontend* or
the *backend* work in two before splitting the AI service — those have
cleaner internal seams (see each plan's phase table).

---

## The one thing that connects all three: the contract, not the code

Nobody needs to wait for anybody else's code to be finished. Everybody builds
against [`architecture/APIS.md`](architecture/APIS.md), which already
documents every request and response shape, marked **live** or **planned**.

- **The frontend engineer** can build `FPLAN_1.md` Phase 1 and Phase 5 today — no backend
  dependency for Phase 1, and Phase 5's endpoints are already live (even
  though they return stub data right now, the shape is final). Phases 2–4 can
  be built as UI shells against `APIS.md`'s documented shapes with fake data,
  then pointed at the real endpoints once they exist — no rework, because the
  contract doesn't change underneath them.
- **The backend developer** can build `BPLAN_1.md` Phase 1's proxy routes
  today, against the documented shapes, before the AI service's real
  implementation lands — same reasoning. Phase 2 (the two platform-side gaps)
  has no dependency on the AI service at all and can start immediately.
- **The AI developer** builds the actual behavior behind those contracts,
  following `AI/PLAN_1.md`'s phase order, without needing to know or care how
  the frontend or the Node routes are built — only that the shape they return
  matches `APIS.md`.

If the contract ever needs to change, that's a conversation between whoever
notices it's wrong and the other two — not a silent change one person makes
and the others discover later. Update `APIS.md` first, then the code that
implements or calls it.

---

## The two real handoff points (not code, conversations)

These are the only two places the three plans ask people to talk to each
other before building, rather than working from the document alone:

1. **Tool risk levels and shapes** (`BACKEND/BPLAN_1.md` Phase 2 ↔
   `AI/PLAN_1.md` Phase 3) — the backend developer builds the branch-search
   and booking endpoints; the AI developer builds the tools that call them.
   Agree on the request/response shape once, early, then build independently.
2. **The follow-up summary shape** (`BACKEND/BPLAN_1.md` Phase 3 ↔
   `AI/PLAN_1.md` Phase 7) — same pattern: agree on the fields once, build
   independently.

Everything else in all three plans is designed to need zero synchronous
coordination — read the relevant plan, read `APIS.md`, build.
