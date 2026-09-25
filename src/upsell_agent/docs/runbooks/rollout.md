# Rolling the AI out to a dealer (MASTER_PLAN_1 Stage 13)

One dealer at a time: **off → shadow for a week → live**, watch it for a week,
then the next dealer. Rollback is always one switch back to `off`.

**Done when** one dealer has been live for a week with no double messages and
no lost replies. `GET /v1/rollout-check` (or `make ai-rollout-check` locally)
measures both.

---

## Before the first dealer

- [ ] The AI service is deployed with `ENVIRONMENT=PROD`, `CHANNEL_DRIVER=live`, real Twilio / SendGrid credentials, `PUBLIC_BASE_URL`, and `SENDGRID_WEBHOOK_PUBLIC_KEY`.
- [ ] Real models are configured (`MODEL_EXTRACT` / `MODEL_COMPOSE` + `OPENAI_API_KEY`), and the eval gate passes on them (`make ai-evals`, or the "AI eval gate" CI check).
- [ ] The platform has `UPSELL_AGENT_API_URL` and the same `UPSELL_SERVICE_SHARED_SECRET` as the AI service.
- [ ] Twilio: each dealer number's status callback reaches `<PUBLIC_BASE_URL>/v1/webhooks/twilio/status`.
- [ ] SendGrid: the event webhook posts to `<PUBLIC_BASE_URL>/v1/webhooks/sendgrid/events`, signed.
- [ ] One real round trip on staging with the team's test numbers (`make ai-provider-check`, with `SEND_ALLOWLIST` set). The reply shows in the conversation screen.
- [ ] The platform's email index exists (`node scripts/ensure-email-indexes.js`).

## Week 1: shadow

1. Set the dealer to shadow (admin token):

   ```
   PUT /api/admin/ai-mode   { "dealer_id": "<id>", "ai_mode": "shadow" }
   ```

   n8n keeps replying exactly as today. The AI gets every event, drafts every reply, and sends nothing.

2. Each day, check the shadow numbers:

   ```
   GET /v1/metrics?dealer_id=<id>&days=1          (shared secret)
   GET /v1/rollout-check?dealer_id=<id>&days=1
   ```

   In shadow, n8n's replies are listed as information, not failures.

3. Review the drafts **on a DEV copy, never against production**:

   ```bash
   make ai-copy-dealer FROM="<read-only production URI>" DEALER=<id> DAYS=7
   ```

   Then open the Debug UI Shadow tab and pick the dealer. Every AI draft sits next to what n8n actually sent. Mark a sample of at least 50 as AI better / same / worse / unsafe.
   - Contacts are masked in the copy.
   - The source is only read.
   - The Debug UI never runs in production.

4. Go on only if:
   - no draft is marked **unsafe**;
   - "worse" is rare, and each one is understood (fix the prompt and rerun the eval gate if needed);
   - the rollout check passes on first-reply time, fallback rate and guard failures.

## Week 2: live

1. Switch the dealer to live:

   ```
   PUT /api/admin/ai-mode   { "dealer_id": "<id>", "ai_mode": "live" }
   ```

   The response's `follow_up_jobs_cleared` says how many rule-based FollowUpJobs were removed. From now on:
   - n8n is not called for this dealer;
   - FollowUpJobs are not created;
   - the AI replies, and switches channel after 24 h without an answer.

2. Watch it daily: `GET /v1/rollout-check?dealer_id=<id>&days=1` must stay all PASS. The four checks that matter most:

   | Check | If it fails |
   |---|---|
   | no platform auto-messages on AI leads | Something besides the AI messaged a live lead (n8n, a FollowUpJob). Roll back, then find the path. |
   | no AI double sends | Roll back and investigate: this should be impossible. |
   | no customer message without a reply or a reason | A message was never handled: check the worker and the queue. (Messages on handed-off, paused or opted-out leads always get a logged reason, so they never show here.) |
   | no events left unhandled | A job never ran: check that the workers are up. |

3. Staff can take any lead over by replying from the conversation screen. The AI pauses that lead.
   A lead the AI handed to staff that nobody picks up within 30 business minutes shows up as a **staff alert** (`staff_alerts` in the rollout check): follow those up with the dealer.
   An admin can hand a lead back:

   ```
   POST /api/admin/ai/leads/<lead id>/resume
   ```

   `.../pause` takes a lead over without replying, and `.../profile` shows what the AI knows.

4. After a clean week, the dealer is done. Start the next one at "Week 1".

## Rollback (any time)

```
PUT /api/admin/ai-mode   { "dealer_id": "<id>", "ai_mode": "off" }
```

- It takes effect within 60 s (the platforms' mode cache): new leads and replies go to n8n again.
- The AI's pending channel switches for that dealer are cancelled when they come due, not sent.
- Nothing else needs undoing.
- The e2e check (section 7) proves this locally.

## Numbers and limits

| Number | Limit | Where |
|---|---|---|
| First reply p95 | < 8 s | metrics `first_reply_ms.p95` |
| Template fallback rate | < 5% | metrics `template_fallback.rate` |
| Guard failure rate | < 10% of turns | metrics `guard_failures.rate` |
| Send failures | < 2% | rollout check `numbers.send_failure_rate` |
| Double messages / lost replies | 0 | rollout check |

The limits live in `agentic-upsell/src/upsell_agent/observability/rollout.py` (`LIMITS`).
