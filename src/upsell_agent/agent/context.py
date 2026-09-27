"""What every pipeline step can reach during one turn, besides the state.

Passed to the graph through `config["configurable"]["ctx"]`. Holds the
dealer-scoped database, the platform client, the models' settings, the
tracer, and a small AI-call budget shared by Extract and Compose
(architecture §7: at most 4 AI calls per turn).
"""

from dataclasses import dataclass, field
from typing import Any

from upsell_agent.config import Settings
from upsell_agent.integrations.mongodb import DealerScopedDatabase
from upsell_agent.integrations.platform_client import PlatformClient
from upsell_agent.observability.trace import TurnTracer
from upsell_agent.tools.inventory_tool import InventorySource


class AiBudgetExceeded(RuntimeError):
    """This turn already used its AI calls; the template goes out instead."""


@dataclass
class TurnContext:
    db: DealerScopedDatabase
    platform: PlatformClient
    settings: Settings
    tracer: TurnTracer
    lead: dict | None
    customer: dict | None
    lead_state: dict | None
    # The customer message this turn answers (links extracted slot values
    # back to the words they came from, architecture §8.4).
    source_message_id: str
    ai_calls: int = 0
    model_calls: list[dict[str, Any]] = field(default_factory=list)
    # Where stock is read (tools/inventory_tool.py); None = the one PLATFORM_CLIENT picks.
    inventory: InventorySource | None = None

    def spend_ai_call(self) -> None:
        if self.ai_calls >= self.settings.max_ai_calls_per_turn:
            raise AiBudgetExceeded(f"already used {self.ai_calls} AI calls this turn")
        self.ai_calls += 1
