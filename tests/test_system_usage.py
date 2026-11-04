"""Dashboard total data usage with node usage coefficients (SYSTEM_USAGE_WITH_COEFFICIENT).

Run inside the Marzban image, like the other tests.
"""
from types import SimpleNamespace

import pytest

from app import xray
from app.db import GetDB
from app.db.base import Base, engine
from app.db.models import System
from app.jobs import record_usages

PARAMS = {
    None: [{"up": 100, "down": 0}],                              # the panel's own core
    1: [{"up": 10, "down": 0}, {"up": 0, "down": 90}],           # node with coefficient 20
    2: [{"up": 0, "down": 40}],                                  # node with coefficient 3.5
}
COEFFICIENTS = {None: 1, 1: 20, 2: 3.5}


def test_default_counts_real_traffic():
    assert record_usages.system_totals(PARAMS, COEFFICIENTS, False) == (110, 130)


def test_with_coefficient_counts_like_users():
    assert record_usages.system_totals(PARAMS, COEFFICIENTS, True) == (100 + 200, 1800 + 140)


def test_unknown_node_counts_once():
    assert record_usages.system_totals({7: [{"up": 5, "down": 5}]}, {None: 1}, True) == (5, 5)


@pytest.fixture
def system_row():
    Base.metadata.create_all(engine)
    with GetDB() as db:
        db.query(System).delete()
        db.add(System(uplink=0, downlink=0))
        db.commit()
    yield
    with GetDB() as db:
        db.query(System).delete()
        db.commit()


@pytest.mark.parametrize("enabled, expected", [(False, (110, 130)), (True, (300, 1940))])
def test_record_node_usages_updates_the_total(system_row, monkeypatch, enabled, expected):
    nodes = {1: SimpleNamespace(connected=True, started=True, api="api-1", usage_coefficient=20),
             2: SimpleNamespace(connected=True, started=True, api="api-2", usage_coefficient=3.5),
             3: SimpleNamespace(connected=False, started=False, api="api-3", usage_coefficient=9)}
    by_api = {"main": PARAMS[None], "api-1": PARAMS[1], "api-2": PARAMS[2], "api-3": [{"up": 999, "down": 999}]}
    monkeypatch.setattr(xray, "nodes", nodes)
    monkeypatch.setattr(xray, "api", "main")
    monkeypatch.setattr(record_usages, "get_outbounds_stats", lambda api: by_api[api])
    monkeypatch.setattr(record_usages, "SYSTEM_USAGE_WITH_COEFFICIENT", enabled)
    monkeypatch.setattr(record_usages, "DISABLE_RECORDING_NODE_USAGE", True)  # only the total here

    record_usages.record_node_usages()

    with GetDB() as db:
        s = db.query(System).first()
        assert (s.uplink, s.downlink) == expected
