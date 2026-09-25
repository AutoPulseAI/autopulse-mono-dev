# Initial setup: run AutoPulse AI locally with the Makefile

Everything runs from the repository root (`autopulse-backend/`) with `make`.
Nothing here sends a real SMS or email: the AI service uses a fake channel
driver, the platform gets placeholder Twilio/Mailgun credentials, and n8n is
replaced by a local stand-in.

`make help` lists every command.

---

## 1. What you need installed

| Tool | Version used | Used for |
|---|---|---|
| Docker Desktop | recent | MongoDB, Redis, AI API, AI worker, Debug UI |
| GNU Make | 4.x | every command below (on Windows: Git Bash's `make`, or `choco install make`) |
| Python + [uv](https://docs.astral.sh/uv/) | Python 3.11+, uv 0.12 | the AI service's tests and evals |
| Node.js | 22+ (24 works) | the platform (`aidmvcs-be-dev`) and the Promptfoo evals |

## 2. One-time setup

```bash
make ai-install          # creates the MongoDB volume + agentic-upsell/.venv (uv sync)
make platform-install    # npm ci for aidmvcs-be-dev
```

Create `agentic-upsell/.env` from the template:

```bash
cp agentic-upsell/.env.example agentic-upsell/.env
```

Then set, in `agentic-upsell/.env`:

| Setting | Value |
|---|---|
| `ENVIRONMENT` | `DEV` (turns on the Debug UI and dev tools) |
| `UPSELL_SERVICE_SHARED_SECRET` | any long random string: `python -c "import secrets; print(secrets.token_urlsafe(32))"`. The platform runner reads it from this file, so both sides always match. |

Leave the rest as it is. The defaults use the offline model, the fake channel
driver and the stub platform client.

Build the AI image once (needs Docker Hub access):

```bash
make ai-build
```

If Docker Hub can't be reached, but an `autopulse-backend-ai-api` image
already exists, skip this. The containers run the source from your checkout
(bind-mounted), so code changes never need a rebuild. Only a change to
`pyproject.toml` does.

## 3. Start the AI service and load test data

```bash
make ai-up        # MongoDB, Redis, AI API (:8100), AI worker, Debug UI (:5173)
make ai-seed      # dev dealers A (live), B (live), C (shadow) + customers, DMS history, leads, a campaign
make ai-ping      # the worker answers a test job
```

- Debug UI: http://localhost:5173. Pick a dealer and a lead, send a simulated
  message, and watch it go through the pipeline.
- AI API health: http://localhost:8100/health

## 4. Run everything together with the platform

In a second terminal (it keeps running, Ctrl+C stops it):

```bash
make dev-full     # AI stack recording into the platform + platform web (:3000) + platform workers
```

This also starts the local n8n stand-in on :3999 (`GET /hits` lists every
call the platform made to "n8n").

Back in the first terminal:

```bash
make ai-e2e        # 35 checks: lead -> AI reply -> SMS reply -> email -> 24h switch -> staff takeover
                   # -> hand-back -> shadow dealer -> rollback (about 2 minutes)
make compare-360   # the AI's Customer 360 vs the platform's real endpoint
```

## 5. Tests

| Command | What it runs | Needs |
|---|---|---|
| `make ai-test` | AI service unit tests | `make ai-install` |
| `make platform-test` | platform unit tests + real-MongoDB worker tests | MongoDB running (`make ai-up`) |
| `make test-all` | both of the above | |
| `make ai-scenarios` | every scenario, live in Docker (same as the Debug UI Scenarios tab) | `make ai-up`, `make ai-seed` |
| `make ai-evals` | the eval gate: DeepEval (extraction + replies) + Promptfoo prompt injection | `make ai-install`, Node |
| `make ai-burst` | burst test: 300 campaign replies in 10 minutes vs another dealer's leads (about 12 min; `REPLIES=300 SECONDS=60` for a harsher run) | `make ai-up` |

## 6. Watching the numbers

```bash
make ai-report                          # first reply time, fallbacks, guard failures, cost, qualified rate
make ai-rollout-check                   # go-live checks: no double messages, no lost replies, numbers in limits
make ai-rollout-check DEALER=<id> DAYS=1
```

The same numbers are in the Debug UI's Metrics tab, and the shadow comparison
is in its Shadow tab.

## 7. Everyday commands

| Command | Does |
|---|---|
| `make ai-restart` | restart the AI API + worker (after changing worker code; the API reloads itself) |
| `make ai-logs` | follow the AI API + worker logs |
| `make ai-down` | stop the AI containers |
| `make ai-seed` | reset the dev data and load it again |

## 8. Using real models (optional)

In `agentic-upsell/.env`, set `OPENAI_API_KEY`. Then, in the shell you run
`make` from:

```bash
export AI_MODEL_EXTRACT=openai:gpt-4o-mini AI_MODEL_COMPOSE=openai:gpt-4o
make ai-up                                  # recreates the containers with the real models
MODEL_EXTRACT=openai:gpt-4o-mini MODEL_COMPOSE=openai:gpt-4o make ai-evals   # the eval gate on the real models
```

Langfuse traces appear once `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` are set.

## 9. Real SMS and email (staging only)

In `agentic-upsell/.env`, set:

- `CHANNEL_DRIVER=live`
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`
- `SENDGRID_API_KEY`
- `SEND_ALLOWLIST=` your team's test phone numbers and emails

Outside production, only those recipients can ever be messaged. For delivery
webhooks, also set `PUBLIC_BASE_URL` and `SENDGRID_WEBHOOK_PUBLIC_KEY`.

```bash
make ai-provider-check DEALER=<dealer id> SMS=+15551234567 EMAIL=you@team.test
```

Reply to the message you receive and check it appears in that dealer's
conversation screen.

## 10. Troubleshooting

| Problem | Fix |
|---|---|
| `make ai-build` can't reach Docker Hub | Skip it if the image exists (see step 2); the source is bind-mounted. |
| `external volume "autopulse-mongo-data" not found` | `make ai-install` (creates it). |
| `make dev-full`: port 3000 already in use | A previous `next dev` is still running. Stop it (Windows: `taskkill /F /IM node.exe` or find the PID on port 3000). |
| The platform worker exits with "Failed to connect to MongoDB" | Check `make ai-up` is running. |
| `npx` fails with `ECOMPROMISED` during `make ai-evals` | `npm cache clean --force`, then run it again. |
| Scenarios fail after a burst test | Leftover follow-ups can fall due when a scenario moves the clock; `make ai-seed` resets the dev data. |
| The Redis checkpointer tests are skipped | Expected: they need Redis Stack (RediSearch); the dev Redis is plain `redis:7`. |
