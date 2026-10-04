"""The engagement report (PLAN_4 stream L item 4): what the CRM's "AI
Insights" page shows (aidmvcs-be-dev/app/dealer/ai/insights).

Rates are counted only on touches old enough to have had their chance: the
24-hour response rate on touches sent more than 24 hours ago, the 72-hour one
(the learning's reward) on touches older than 72 hours, the appointment rate
on touches older than 7 days. Newer touches are in `touches` but not in a
rate's denominator, so a rate never looks low just because replies haven't
had time to arrive.
"""

from collections import defaultdict
from collections.abc import Callable
from datetime import datetime, timedelta
from typing import Any

from upsell_agent import clock
from upsell_agent.agent import cadence
from upsell_agent.agent.lead_bucket import BUCKETS
from upsell_agent.integrations.mongodb import AI_TOUCHES_COLLECTION, DealerScopedDatabase
from upsell_agent.learning import bandit, price_watch, variants
from upsell_agent.learning.touches import (
    APPOINTMENT_WINDOW,
    KIND_CADENCE,
    KIND_LABELS,
    REPLY_WINDOW,
    REPLY_WINDOW_SHORT,
    TIME_BAND_LABELS,
    WEEKDAYS,
    aware,
)

MAX_ROWS = 50_000
BUCKET_LABELS = {"credit": "Credit", "trade_in": "Trade-in", "general": "General shopping", "none": "No bucket"}
VEHICLE_TYPE_LABELS = {"new": "New", "used": "Used", "unknown": "Not known yet"}
CHANNEL_LABELS = {"sms": "Text", "email": "Email"}


def _rate(wins: int, n: int) -> float | None:
    return round(wins / n, 4) if n else None


class _Tally:
    def __init__(self) -> None:
        self.touches = 0
        self.settled_24h = self.replied_24h = 0
        self.settled_72h = self.replied_72h = self.meaningful = 0
        self.settled_7d = self.appointments = self.showed = 0
        self.opted_out = 0

    def add(self, row: dict[str, Any], now: datetime) -> None:
        sent = aware(row.get("sent_at"))
        age = now - sent if sent else timedelta(0)
        self.touches += 1
        if age >= REPLY_WINDOW_SHORT:
            self.settled_24h += 1
            self.replied_24h += bool(row.get("replied_24h"))
        if age >= REPLY_WINDOW:
            self.settled_72h += 1
            self.replied_72h += bool(row.get("replied_72h"))
            self.meaningful += bool(row.get("meaningful_reply"))
        if age >= APPOINTMENT_WINDOW:
            self.settled_7d += 1
            self.appointments += bool(row.get("appointment_7d"))
            self.showed += bool(row.get("showed_at"))
        self.opted_out += bool(row.get("opted_out_at"))

    def as_dict(self) -> dict[str, Any]:
        return {
            "touches": self.touches,
            "response_rate_24h": _rate(self.replied_24h, self.settled_24h), "replied_24h": self.replied_24h,
            "settled_24h": self.settled_24h,
            "response_rate": _rate(self.replied_72h, self.settled_72h), "replied": self.replied_72h,
            "settled": self.settled_72h,
            "meaningful_rate": _rate(self.meaningful, self.settled_72h), "meaningful": self.meaningful,
            "appointment_rate": _rate(self.appointments, self.settled_7d), "appointments": self.appointments,
            "settled_7d": self.settled_7d, "showed": self.showed,
            "opt_out_rate": _rate(self.opted_out, self.touches), "opted_out": self.opted_out,
        }


def _breakdown(rows: list[dict], now: datetime, key: Callable[[dict], str | None],
               label: Callable[[str], str], order: list[str] | None = None) -> list[dict[str, Any]]:
    tallies: dict[str, _Tally] = defaultdict(_Tally)
    for row in rows:
        if (k := key(row)) is not None:
            tallies[k].add(row, now)
    keys = list(tallies)
    if order:
        keys.sort(key=lambda k: order.index(k) if k in order else len(order))
    else:
        keys.sort(key=lambda k: -tallies[k].touches)
    return [{"key": k, "label": label(k), **tallies[k].as_dict()} for k in keys]


def _theme_label(theme: str) -> str:
    found = cadence.BY_ID.get(theme)
    return found.label if found else theme.replace("_", " ").capitalize()


def winners(rows: list[dict], now: datetime) -> list[dict[str, Any]]:
    """Per test (each theme's wording, and the send time): the option with the best expected 72-hour response
    rate (the same posterior the learning uses, with no platform prior), and whether there's enough data to
    call it."""
    tests: dict[str, dict[str, bandit.ArmStats]] = defaultdict(lambda: defaultdict(bandit.ArmStats))
    for row in rows:
        sent = aware(row.get("sent_at"))
        if row.get("kind") != KIND_CADENCE or not sent or now - sent < REPLY_WINDOW:
            continue
        if row.get("theme") and row.get("variant") and row["variant"] != "price_drop":
            arm = tests[f"wording:{row['theme']}"][row["variant"]]
            arm.n += 1
            arm.wins += bool(row.get("replied_72h"))
        if row.get("time_variant"):
            arm = tests["send_time"][row["time_variant"]]
            arm.n += 1
            arm.wins += bool(row.get("replied_72h"))
    out = []
    for test, arms in sorted(tests.items()):
        scored = []
        for option, stats in arms.items():
            alpha, beta = bandit.posterior(stats, bandit.ArmStats())
            scored.append((alpha / (alpha + beta), option, stats))
        scored.sort(reverse=True)
        enough = len(scored) > 1 and all(s.n >= bandit.MIN_SAMPLES for _, _, s in scored)
        if test == "send_time":
            name, label = "Send time", lambda o: variants.SEND_TIME_LABELS.get(o, o)
        else:
            theme = test.split(":", 1)[1]
            name, label = f"Wording: {_theme_label(theme)}", lambda o, t=theme: variants.variant_label(t, o)
        out.append({
            "test": test, "label": name, "leader": scored[0][1], "leader_label": label(scored[0][1]),
            "enough_data": enough,
            "status": ("Winning: used more often from now on" if enough else
                       f"Still testing: needs {bandit.MIN_SAMPLES} settled touches per option"),
            "options": [{"option": o, "label": label(o), "touches": s.n, "replied": s.wins,
                         "response_rate": _rate(s.wins, s.n), "expected_rate": round(e, 4)}
                        for e, o, s in scored],
        })
    return out


async def engagement(db: DealerScopedDatabase, *, days: int = 30, now: datetime | None = None) -> dict[str, Any]:
    now = now or clock.now()
    days = max(1, min(int(days), 365))
    since = now - timedelta(days=days)
    rows = await db.collection(AI_TOUCHES_COLLECTION).find(
        {"sent_at": {"$gte": since, "$lte": now}}, projection={"_id": 0}).to_list(MAX_ROWS)
    total = _Tally()
    for row in rows:
        total.add(row, now)
    cadence_rows = [r for r in rows if r.get("kind") == KIND_CADENCE]
    theme_order = [t.id for t in (*cadence.DAY_THEMES, cadence.PRICE_CHANGE, cadence.NAME_NUDGE)]
    drops = await price_watch.drops(db, now)
    return {
        "dealer_id": db.dealer_id, "days": days, "since": since.isoformat(), "generated_at": now.isoformat(),
        "totals": total.as_dict(),
        "by_kind": _breakdown(rows, now, lambda r: r.get("kind"), lambda k: KIND_LABELS.get(k, k)),
        "by_bucket": _breakdown(rows, now, lambda r: r.get("bucket") or "none",
                                lambda k: BUCKET_LABELS.get(k, k), order=[*BUCKETS, "none"]),
        "by_original_bucket": _breakdown(rows, now, lambda r: r.get("original_bucket") or "none",
                                         lambda k: BUCKET_LABELS.get(k, k), order=[*BUCKETS, "none"]),
        "by_source": _breakdown(rows, now, lambda r: r.get("source") or "unknown", lambda k: k.title()),
        "by_vehicle_type": _breakdown(rows, now, lambda r: r.get("vehicle_type") or "unknown",
                                      lambda k: VEHICLE_TYPE_LABELS.get(k, k), order=["new", "used", "unknown"]),
        "by_original_vehicle_type": _breakdown(
            rows, now, lambda r: r.get("original_vehicle_type") or "unknown",
            lambda k: VEHICLE_TYPE_LABELS.get(k, k), order=["new", "used", "unknown"]),
        "by_angle": _breakdown(cadence_rows, now, lambda r: r.get("theme"), _theme_label, order=theme_order),
        "by_variant": _breakdown(
            cadence_rows, now, lambda r: f"{r['theme']}:{r['variant']}" if r.get("theme") and r.get("variant")
            else None,
            lambda k: ("Price drop announcement" if k.endswith(":price_drop")
                       else variants.variant_label(*k.split(":", 1)))),
        "by_send_time": _breakdown(cadence_rows, now, lambda r: r.get("time_variant"),
                                   lambda k: variants.SEND_TIME_LABELS.get(k, k), order=list(variants.SEND_TIMES)),
        "by_time_band": _breakdown(rows, now, lambda r: r.get("time_band"), lambda k: TIME_BAND_LABELS.get(k, k),
                                   order=list(TIME_BAND_LABELS)),
        "by_weekday": _breakdown(rows, now, lambda r: r.get("weekday"), lambda k: k, order=list(WEEKDAYS)),
        "by_channels": _breakdown(rows, now, lambda r: "+".join(sorted(r.get("channels") or [])) or None,
                                  lambda k: " + ".join(CHANNEL_LABELS.get(c, c) for c in k.split("+"))),
        "winners": winners(rows, now),
        "price_drops": [{**d, "dropped_at": d["dropped_at"].isoformat(), "checked_at": d["checked_at"].isoformat()}
                        for d in drops],
        "learning": {
            "method": ("Each follow-up's angle (Days 8-90), wording and send time is picked by Thompson sampling: "
                       "options that get more replies within 72 hours are used more often, and the others are "
                       "still tried now and then. The comparison is made among leads like this one (bucket, "
                       "source, new or used, time of day) when there's enough data, else more broadly."),
            "min_samples": bandit.MIN_SAMPLES, "prior_strength": bandit.PRIOR_STRENGTH,
            "reward": "the customer replied within 72 hours",
            "until_ready": ("Until every option has enough settled touches, angles keep the standard order and "
                            "wording / send times are split evenly."),
        },
    }
