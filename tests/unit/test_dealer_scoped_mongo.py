"""Tests for integrations/mongodb.py's DealerScopedCollection — the
enforcement point the previous AI plan (git history) calls "the most important
item in the whole plan": no individual query can forget dealer_id, because it
never gets the chance to build a raw, unscoped filter.

Uses an in-memory fake in place of a real AsyncIOMotorCollection — no live
MongoDB needed. The fake implements just enough of the Motor surface
(find_one, insert_one, update_one, count_documents) for DealerScopedCollection
to be exercised faithfully; it is intentionally NOT a general-purpose mock, so
that a bug in DealerScopedCollection's own filter-merging logic can't hide
behind a mock that quietly accepts whatever it's given.
"""

import pytest

from upsell_agent.integrations.mongodb import CrossDealerAccessError, DealerScopedCollection


class FakeMotorCollection:
    """A tiny in-memory stand-in for AsyncIOMotorCollection, async to match
    the real interface's calling convention."""

    def __init__(self):
        self.docs: list[dict] = []

    async def find_one(self, filter=None, **kwargs):
        filter = filter or {}
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in filter.items()):
                return dict(doc)
        return None

    async def insert_one(self, document, **kwargs):
        self.docs.append(dict(document))

    async def update_one(self, filter, update, upsert=False, **kwargs):
        for doc in self.docs:
            if all(doc.get(k) == v for k, v in filter.items()):
                doc.update(update.get("$set", {}))
                return
        if upsert:
            new_doc = dict(filter)
            new_doc.update(update.get("$set", {}))
            new_doc.update(update.get("$setOnInsert", {}))
            self.docs.append(new_doc)

    async def count_documents(self, filter=None, **kwargs):
        filter = filter or {}
        return sum(1 for doc in self.docs if all(doc.get(k) == v for k, v in filter.items()))


@pytest.fixture
def raw_collection() -> FakeMotorCollection:
    return FakeMotorCollection()


def test_rejects_empty_dealer_id(raw_collection):
    with pytest.raises(ValueError):
        DealerScopedCollection(raw_collection, "")


async def test_find_one_is_scoped_to_the_given_dealer(raw_collection):
    raw_collection.docs = [
        {"dealer_id": "dealer_a", "customer_id": "c1", "budget": 25000},
        {"dealer_id": "dealer_b", "customer_id": "c1", "budget": 99999},
    ]
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    result = await scoped.find_one({"customer_id": "c1"})

    assert result["dealer_id"] == "dealer_a"
    assert result["budget"] == 25000


async def test_dealer_a_cannot_read_dealer_b_data_by_asking_for_it_explicitly(raw_collection):
    """This is the exact scenario the previous AI plan (git history) requires:
    'a dedicated test that requests Dealer B's data while acting as Dealer A
    ... confirms it fails.' A caller that's confused (or compromised) and
    tries to pass dealer_id='dealer_b' into a filter while holding a
    DealerScopedCollection scoped to dealer_a must be refused, not silently
    corrected.
    """
    raw_collection.docs = [{"dealer_id": "dealer_b", "customer_id": "c1", "budget": 99999}]
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    with pytest.raises(CrossDealerAccessError):
        await scoped.find_one({"dealer_id": "dealer_b", "customer_id": "c1"})


async def test_find_one_scoped_to_own_dealer_with_explicit_matching_id_is_allowed(raw_collection):
    raw_collection.docs = [{"dealer_id": "dealer_a", "customer_id": "c1", "budget": 25000}]
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    result = await scoped.find_one({"dealer_id": "dealer_a", "customer_id": "c1"})

    assert result is not None


async def test_insert_one_stamps_dealer_id_automatically(raw_collection):
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    await scoped.insert_one({"customer_id": "c1", "budget": 25000})

    assert raw_collection.docs[0]["dealer_id"] == "dealer_a"


async def test_insert_one_rejects_a_document_stamped_for_another_dealer(raw_collection):
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    with pytest.raises(CrossDealerAccessError):
        await scoped.insert_one({"dealer_id": "dealer_b", "customer_id": "c1"})

    assert raw_collection.docs == []


async def test_update_one_cannot_touch_another_dealers_document(raw_collection):
    raw_collection.docs = [{"dealer_id": "dealer_b", "customer_id": "c1", "budget": 99999}]
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    # Filter only names customer_id — dealer_id gets forced to dealer_a, so
    # this must find NOTHING and, with upsert, create a NEW dealer_a document
    # rather than silently mutating dealer_b's existing one.
    await scoped.update_one({"customer_id": "c1"}, {"$set": {"budget": 1}}, upsert=True)

    dealer_b_doc = next(d for d in raw_collection.docs if d["dealer_id"] == "dealer_b")
    dealer_a_doc = next(d for d in raw_collection.docs if d["dealer_id"] == "dealer_a")
    assert dealer_b_doc["budget"] == 99999  # untouched
    assert dealer_a_doc["budget"] == 1


async def test_update_one_upsert_stamps_dealer_id_via_set_on_insert(raw_collection):
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    await scoped.update_one({"customer_id": "new"}, {"$set": {"budget": 5}}, upsert=True)

    assert raw_collection.docs[0]["dealer_id"] == "dealer_a"


async def test_count_documents_is_scoped(raw_collection):
    raw_collection.docs = [
        {"dealer_id": "dealer_a", "customer_id": "c1"},
        {"dealer_id": "dealer_a", "customer_id": "c2"},
        {"dealer_id": "dealer_b", "customer_id": "c3"},
    ]
    scoped = DealerScopedCollection(raw_collection, "dealer_a")

    assert await scoped.count_documents({}) == 2
