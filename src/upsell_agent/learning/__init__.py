"""The AI Learning & Optimization Engine (client blueprint box 5; PLAN_4 stream L).

- touches.py      one row per outbound AI touch, with its context and what the customer did after it
- bandit.py       the explainable chooser (Thompson sampling with a platform prior and a minimum sample)
- variants.py     the wording variants per cadence theme and the send-time variants
- optimizer.py    picks the angle / wording / send time for a cadence touch from the observed response rates
- price_watch.py  price snapshots per (dealer, VIN) and verified price drops
- insights.py     the engagement report (GET /v1/insights/engagement)
"""
