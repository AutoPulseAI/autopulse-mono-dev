"""The chooser behind the learning (PLAN_4 stream L item 2): Thompson
sampling over Beta posteriors, with a platform-wide prior and a minimum
sample, so it stays simple to explain.

For each option (an angle, a wording variant, a send time) in the lead's
context:

    the platform's response rate for it (every dealer)  -> the prior, worth at most PRIOR_STRENGTH touches
    this dealer's own touches with it                    -> counted in full
    posterior = Beta(1 + prior replies + dealer replies, 1 + prior no-replies + dealer no-replies)

One draw from each posterior; the highest draw wins. An option that keeps
getting replies wins more and more often, and one with few touches still gets
tried now and then (that is the A/B test continuing on its own).

**Minimum sample:** until every option has MIN_SAMPLES settled touches
(dealer and platform together) the learning doesn't choose - the caller keeps
its own default (today's fixed order for angles; an even random split for
wording and send-time tests). So a new dealer behaves exactly like before.

Pure: no database, no clock. The random draws come from the `rng` given, which
callers seed from the dealer, lead and touch so a decision is repeatable (and
deterministic in tests).
"""

import random
from dataclasses import asdict, dataclass, field
from typing import Any

MIN_SAMPLES = 30
PRIOR_STRENGTH = 20.0


@dataclass
class ArmStats:
    """Settled touches (`n`) and how many got a reply in 72 hours (`wins`)."""
    n: int = 0
    wins: int = 0

    @property
    def rate(self) -> float | None:
        return self.wins / self.n if self.n else None


@dataclass
class Choice:
    option: str
    method: str  # "learned" | "default" | "split"
    why: str
    level: str | None = None
    scores: dict[str, dict[str, Any]] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def posterior(dealer: ArmStats, platform: ArmStats, prior_strength: float = PRIOR_STRENGTH) -> tuple[float, float]:
    """Beta(alpha, beta) for one option: a uniform Beta(1, 1), plus the platform's data scaled down to at most
    `prior_strength` touches, plus this dealer's own data in full."""
    weight = min(1.0, prior_strength / platform.n) if platform.n else 0.0
    alpha = 1.0 + platform.wins * weight + dealer.wins
    beta = 1.0 + (platform.n - platform.wins) * weight + (dealer.n - dealer.wins)
    return alpha, beta


def ready(stats: dict[str, tuple[ArmStats, ArmStats]], min_samples: int = MIN_SAMPLES) -> bool:
    return bool(stats) and all(d.n + p.n >= min_samples for d, p in stats.values())


def thompson(options: list[str], stats: dict[str, tuple[ArmStats, ArmStats]], rng: random.Random,
             *, level: str | None = None) -> Choice:
    """One draw per option from its posterior; the highest wins."""
    scores: dict[str, dict[str, Any]] = {}
    best, best_draw = options[0], -1.0
    for option in options:
        dealer, platform = stats.get(option, (ArmStats(), ArmStats()))
        alpha, beta = posterior(dealer, platform)
        draw = rng.betavariate(alpha, beta)
        scores[option] = {"dealer_n": dealer.n, "dealer_replies": dealer.wins, "platform_n": platform.n,
                          "platform_replies": platform.wins, "expected_rate": round(alpha / (alpha + beta), 4),
                          "draw": round(draw, 4)}
        if draw > best_draw:
            best, best_draw = option, draw
    expected = scores[best]["expected_rate"]
    return Choice(best, "learned", f"learned from response rates ({level or 'all touches'}): {best} drew highest "
                                   f"(about {expected:.0%} expected to reply)", level, scores)


def choose(options: list[str], levels: list[tuple[str, dict[str, tuple[ArmStats, ArmStats]]]], rng: random.Random,
           *, default: str | None = None, min_samples: int = MIN_SAMPLES) -> Choice:
    """The option to use. `levels`: the stats per option from the most specific context to the broadest
    (e.g. bucket + source + new/used + time band, then bucket + new/used, then bucket, then all); the most
    specific level where every option has `min_samples` is used. With none ready: `default` when given
    (today's behaviour), else an even random split (the A/B test's assignment)."""
    if not options:
        raise ValueError("no options to choose from")
    if len(options) == 1:
        return Choice(options[0], "default", "only one option")
    for level, stats in levels:
        subset = {o: stats.get(o, (ArmStats(), ArmStats())) for o in options}
        if ready(subset, min_samples):
            return thompson(options, subset, rng, level=level)
    fewest = min((sum(s.n for s in levels[-1][1].get(o, (ArmStats(), ArmStats()))) for o in options),
                 default=0) if levels else 0
    if default is not None:
        return Choice(default, "default", f"not enough data yet (fewest {fewest} of {min_samples} touches per "
                                          "option): the standard order")
    pick = options[rng.randrange(len(options))]
    return Choice(pick, "split", f"A/B test: assigned at random (fewest {fewest} of {min_samples} touches per "
                                 "option so far)")
