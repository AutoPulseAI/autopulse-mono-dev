"""Dealer stock for the dev dealers (MASTER_PLAN_3 Phase 1; Phase 6 grows it
to 20-40 per dealer).

Shaped like the platform's vAuto import (aidmvcs-be-dev/app/lib/import.js):
lowercase feed columns (`exteriorcolor`, `mileage`, `body`, `condition`,
`inventoryUrl`, `imagesSecure`), a numeric `year` and the dealer id as a
string in `dealerId`. Marked `dev_inventory: True` (and `dev_seed: True`, so
`make ai-seed` clears it).

The seed's DMS-history customer cars live in the same `vehicles` collection,
so in dev a search can also return them. In production it can't: only the
vAuto feed writes `vehicles` (DealerVault doesn't).

`make ai-seed` loads it with everything else. To reload only the stock
(nothing else is cleared):  python -m upsell_agent.devtools.dev_inventory
"""

import hashlib
from typing import Any

from upsell_agent import clock
from upsell_agent.devtools.simulate import DEV_DEALERS
from upsell_agent.integrations.mongodb import PLATFORM_VEHICLES_COLLECTION, dealer_scoped_db

DEALER_A, DEALER_B = DEV_DEALERS[0]["_id"], DEV_DEALERS[1]["_id"]

# (year, make, model, trim, body, condition, colour, miles, price)
# Phase 6 item 1: 20-40 per dealer, several colours and body types (including
# Coupe/Convertible/Hatchback and Minivan/Van, the size tiers used by
# tools/stock_search.py's "something bigger" that the original 12-per-dealer
# set didn't reach).
STOCK: dict[str, list[tuple]] = {
    DEALER_A: [
        (2025, "Toyota", "RAV4", "XLE Hybrid", "SUV", "new", "White", 12, 36900),
        (2025, "Toyota", "RAV4", "LE", "SUV", "new", "Silver", 8, 31400),
        (2022, "Toyota", "RAV4", "XLE", "SUV", "used", "Blue", 31200, 27995),
        (2021, "Toyota", "RAV4", "LE", "SUV", "used", "Silver", 44800, 24500),
        (2020, "Toyota", "RAV4", "Adventure", "SUV", "used", "Green", 52000, 23900),
        (2023, "Honda", "CR-V", "EX", "SUV", "used", "Gray", 21000, 29500),
        (2024, "Honda", "CR-V", "EX-L", "SUV", "new", "Black", 11, 34900),
        (2025, "Toyota", "Camry", "SE", "Sedan", "new", "Black", 10, 30200),
        (2021, "Toyota", "Camry", "LE", "Sedan", "used", "White", 38000, 21900),
        (2023, "Honda", "Accord", "Sport", "Sedan", "used", "Silver", 24000, 26900),
        (2022, "Ford", "F-150", "XLT", "Truck", "used", "Red", 36500, 34900),
        (2024, "Ford", "F-150", "Lariat", "Truck", "new", "Blue", 6, 48900),
        (2020, "Chevrolet", "Silverado", "LT", "Truck", "used", "White", 58000, 31800),
        (2023, "Toyota", "Tacoma", "SR5", "Truck", "used", "Gray", 18900, 33500),
        (2019, "Nissan", "Altima", "SV", "Sedan", "used", "Blue", 61000, 15900),
        (2023, "Chrysler", "Pacifica", "Touring", "Minivan", "used", "White", 27000, 29900),
        (2025, "Honda", "Odyssey", "EX-L", "Minivan", "new", "Silver", 15, 39900),
        (2022, "Ford", "Mustang", "GT", "Coupe", "used", "Yellow", 19500, 32900),
        (2024, "Ford", "Mustang", "EcoBoost", "Convertible", "new", "Red", 9, 38900),
        (2021, "Honda", "Civic", "LX", "Hatchback", "used", "Blue", 33500, 19900),
        (2023, "Toyota", "Corolla", "SE", "Hatchback", "used", "Orange", 21000, 20900),
        (2020, "GMC", "Sierra", "SLE", "Truck", "used", "Black", 47000, 28900),
        (2024, "Toyota", "Highlander", "Limited", "SUV", "new", "Pearl", 7, 44900),
        (2019, "Jeep", "Wrangler", "Sport", "SUV", "used", "Green", 52000, 27900),
    ],
    DEALER_B: [
        (2025, "Tesla", "Model Y", "Long Range", "SUV", "new", "White", 5, 47990),
        (2023, "Tesla", "Model Y", "Long Range", "SUV", "used", "Black", 22000, 36900),
        (2022, "Tesla", "Model 3", "Standard", "Sedan", "used", "Red", 30100, 27400),
        (2025, "Honda", "CR-V", "EX-L", "SUV", "new", "Blue", 9, 36200),
        (2022, "Honda", "CR-V", "EX", "SUV", "used", "Silver", 29800, 27900),
        (2021, "Honda", "CR-V", "LX", "SUV", "used", "White", 41200, 24800),
        (2020, "Honda", "CR-V", "Touring", "SUV", "used", "Black", 55000, 23500),
        (2024, "Subaru", "Outback", "Premium", "Wagon", "new", "Green", 14, 33100),
        (2021, "Subaru", "Forester", "Sport", "SUV", "used", "Orange", 39000, 25600),
        (2022, "Mazda", "CX-5", "Touring", "SUV", "used", "Red", 27000, 25900),
        (2023, "Honda", "Civic", "Sport", "Sedan", "used", "Gray", 16500, 23900),
        (2019, "Audi", "Q5", "Premium", "SUV", "used", "Blue", 58000, 22800),
        (2024, "Kia", "Sorento", "EX", "SUV", "new", "White", 13, 35900),
        (2022, "Kia", "Telluride", "SX", "SUV", "used", "Black", 24500, 38900),
        (2023, "Toyota", "Sienna", "XLE", "Minivan", "used", "Silver", 22000, 36900),
        (2021, "Chevrolet", "Camaro", "SS", "Coupe", "used", "Yellow", 28000, 34900),
        (2024, "Chevrolet", "Camaro", "LT", "Convertible", "new", "Blue", 8, 39900),
        (2022, "Mazda", "Mazda3", "Premium", "Hatchback", "used", "Red", 18000, 22900),
        (2023, "Subaru", "Impreza", "Sport", "Hatchback", "used", "Blue", 20000, 21900),
        (2020, "Ram", "1500", "Big Horn", "Truck", "used", "Black", 45000, 32900),
        (2024, "Ram", "1500", "Laramie", "Truck", "new", "White", 10, 51900),
        (2022, "BMW", "X5", "xDrive40i", "SUV", "used", "Gray", 29000, 49900),
        (2019, "Volkswagen", "Atlas", "SE", "SUV", "used", "Green", 51000, 24900),
        (2023, "Toyota", "Prius", "LE", "Hatchback", "new", "Silver", 3200, 28900),
    ],
}


def stock_vin(dealer_id: str, index: int, salt: str = "") -> str:
    """A stable 17-character VIN-like id per dealer and row."""
    digest = hashlib.sha256(f"{dealer_id}:{index}:{salt}".encode()).hexdigest().upper()
    return ("DEV" + digest)[:17]


def stock_record(dealer_id: str, index: int, row: tuple, salt: str = "") -> dict[str, Any]:
    year, make, model, trim, body, condition, colour, miles, price = row
    vin = stock_vin(dealer_id, index, salt)
    now = clock.now()
    return {
        "dealerId": dealer_id, "vin": vin,
        "year": year, "make": make, "model": model, "trim": trim, "body": body, "condition": condition,
        "exteriorcolor": colour, "mileage": miles, "internetreduced": price, "instoreprice": price + 1500,
        "inventoryUrl": f"https://dev-dealer.example/inventory/{vin}",
        "imagesSecure": [f"https://dev-dealer.example/photos/{vin}/1.jpg"],
        "createdAt": now, "updatedAt": now,
        "dev_seed": True, "dev_inventory": True,
    }


async def insert_stock(dealer_id: str, rows: list[tuple], salt: str = "") -> list[dict[str, Any]]:
    vehicles = dealer_scoped_db(dealer_id).collection(PLATFORM_VEHICLES_COLLECTION, dealer_field="dealerId")
    records = [stock_record(dealer_id, i, row, salt) for i, row in enumerate(rows)]
    for record in records:
        await vehicles.insert_one(record)
    return records


async def seed_stock() -> int:
    count = 0
    for dealer_id, rows in STOCK.items():
        count += len(await insert_stock(dealer_id, rows))
    return count


async def replace_stock() -> int:
    """Only the dev stock, without re-seeding everything else."""
    from upsell_agent.integrations.mongodb import get_db

    await get_db()[PLATFORM_VEHICLES_COLLECTION].delete_many(
        {"dev_inventory": True, "dealerId": {"$in": list(STOCK)}})
    return await seed_stock()


async def _cli() -> int:
    from upsell_agent.config import get_settings
    from upsell_agent.integrations.mongodb import close_mongo, init_mongo

    settings = get_settings()
    if not settings.is_dev:
        print("Only runs with ENVIRONMENT=DEV.")
        return 2
    await init_mongo(settings)
    try:
        count = await replace_stock()
    finally:
        await close_mongo()
    print(f"Dev stock replaced: {count} vehicles")
    return 0


if __name__ == "__main__":
    import asyncio
    import sys

    sys.exit(asyncio.run(_cli()))
