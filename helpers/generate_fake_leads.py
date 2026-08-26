#!/usr/bin/env python3
"""Generate a CSV of fake leads matching the dealer bulk-upload format.

Headers: name,email,phone,make,model,year,vin,comments
(see app/dealer/leads/components/ImportLeadsModal.js and
app/api/leads/import/route.js in aidmvcs-be-dev)

Usage:
    python3 generate_fake_leads.py -n 50
    python3 generate_fake_leads.py -n 200 -o my_leads.csv
"""

import argparse
import csv
import random
import string
from datetime import datetime
from pathlib import Path

FIRST_NAMES = [
    "James", "Mary", "Robert", "Patricia", "John", "Jennifer", "Michael",
    "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan",
    "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
]

LAST_NAMES = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez",
    "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
]

VEHICLES = [
    ("Honda", "Civic"), ("Honda", "CR-V"), ("Toyota", "Camry"),
    ("Toyota", "RAV4"), ("Ford", "F-150"), ("Ford", "Explorer"),
    ("Chevrolet", "Silverado"), ("Chevrolet", "Equinox"), ("Jeep", "Wrangler"),
    ("Jeep", "Grand Cherokee"), ("Nissan", "Altima"), ("Nissan", "Rogue"),
    ("Subaru", "Outback"), ("Hyundai", "Elantra"), ("Kia", "Sportage"),
    ("BMW", "3 Series"), ("Tesla", "Model 3"), ("Ram", "1500"),
]

COMMENTS = [
    "Interested in a test drive this weekend.",
    "Looking to trade in current vehicle.",
    "Asked about financing options.",
    "Wants to know if it's still available.",
    "Requested more photos of the vehicle.",
    "Comparing with a similar model at another dealer.",
    "Ready to buy, just needs to see it in person.",
    "Asked about extended warranty options.",
]

# VIN charset excludes I, O, Q to avoid confusion with 1 and 0 (matches the
# real VIN format the app validates against, see pulse/autopulse.py's
# vin_pattern).
VIN_CHARS = "".join(c for c in string.ascii_uppercase + string.digits if c not in "IOQ")


def random_vin():
    return "".join(random.choices(VIN_CHARS, k=17))


def random_phone():
    area_code = random.randint(200, 989)
    exchange = 555  # fictional-number exchange code, never a real line
    line = random.randint(0, 9999)
    return f"{area_code}{exchange}{line:04d}"


def random_year():
    return random.randint(2015, 2025)


def random_name():
    return f"{random.choice(FIRST_NAMES)} {random.choice(LAST_NAMES)}"


def generate_lead(index, name=None, phone=None):
    name = name or random_name()
    first, _, last = name.partition(" ")
    make, model = random.choice(VEHICLES)

    return {
        "name": name,
        "email": f"{first.lower()}.{last.lower() or 'lead'}+{index}@example.com",
        "phone": phone or random_phone(),
        "make": make,
        "model": model,
        "year": random_year(),
        "vin": random_vin(),
        "comments": random.choice(COMMENTS),
    }


def main():
    parser = argparse.ArgumentParser(description="Generate fake leads for bulk CSV import testing.")
    parser.add_argument("-n", "--count", type=int, default=25, help="Number of leads to generate (default: 25)")
    parser.add_argument("-o", "--output", type=str, default=None, help="Output filename (default: fake_leads_<timestamp>.csv)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed, for reproducible output")
    parser.add_argument(
        "--same-customer", type=int, default=0, metavar="N",
        help="Also append N extra leads that all share one identical name+phone "
             "(distinct email/vehicle/comments per row), to test multiple leads "
             "resolving to the same Customer.",
    )
    args = parser.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    output_dir = Path(__file__).parent / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    filename = args.output or f"fake_leads_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
    output_path = output_dir / filename

    headers = ["name", "email", "phone", "make", "model", "year", "vin", "comments"]

    with open(output_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=headers)
        writer.writeheader()
        for i in range(args.count):
            writer.writerow(generate_lead(i))

        if args.same_customer > 0:
            shared_name = random_name()
            shared_phone = random_phone()
            for i in range(args.same_customer):
                writer.writerow(generate_lead(f"dup{i}", name=shared_name, phone=shared_phone))

    total = args.count + args.same_customer
    print(f"Wrote {total} fake leads to {output_path}")
    if args.same_customer > 0:
        print(f"  -> {args.same_customer} of them share name={shared_name!r} phone={shared_phone!r}")


if __name__ == "__main__":
    main()
