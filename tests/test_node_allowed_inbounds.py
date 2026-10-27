"""Per-node inbound selection (nodes.allowed_inbounds).

Run inside the Marzban image (it has xray and the dependencies):
    docker run --rm -v "$PWD/tests:/code/tests" <image> bash -c "pip install pytest && python -m pytest tests"
"""
import json
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app import xray
from app.db import GetDB, crud
from app.db.base import Base, engine
from app.models.node import NodeCreate, NodeModify, NodeResponse
from app.routers.node import add_host_if_needed
from app.xray import operations

USER_TAGS = {"VMESS_TCP", "VLESS_TCP", "TROJAN_TCP", "FALLBACK_MAIN", "WS_CHILD"}


def tags(config):
    return {i["tag"] for i in json.loads(config.to_json())["inbounds"]}


def dbnode(name, allowed_inbounds):
    return SimpleNamespace(name=name, allowed_inbounds=allowed_inbounds)


@pytest.fixture
def config():
    return xray.config.copy()


def test_filter_keeps_selected_and_non_user_inbounds(config):
    before = config.to_json()

    filtered = config.filter_inbounds(["VMESS_TCP"])

    assert tags(filtered) == {"API_INBOUND", "VMESS_TCP", "EXTRA_DOKO"}
    assert config.to_json() == before
    # deep copy: changing what goes to a node never leaks into the shared config
    filtered.get_inbound("VMESS_TCP")["settings"]["clients"].append({"email": "x"})
    assert config.to_json() == before


def test_two_nodes_get_only_their_own_inbounds(config):
    before = config.to_json()
    node_a, node_b = SimpleNamespace(), SimpleNamespace()

    config_a = operations._node_config(node_a, dbnode("a", ["VMESS_TCP"]), config)
    config_b = operations._node_config(node_b, dbnode("b", ["VLESS_TCP", "TROJAN_TCP"]), config)

    assert tags(config_a) & USER_TAGS == {"VMESS_TCP"}
    assert tags(config_b) & USER_TAGS == {"VLESS_TCP", "TROJAN_TCP"}
    assert "API_INBOUND" in tags(config_a) and "API_INBOUND" in tags(config_b)
    assert node_a.allowed_inbounds == {"VMESS_TCP"}
    assert node_b.allowed_inbounds == {"VLESS_TCP", "TROJAN_TCP"}
    assert config.to_json() == before


@pytest.mark.parametrize("allowed", [None, []])
def test_no_selection_sends_the_config_unchanged(config, allowed):
    node = SimpleNamespace()

    assert operations._node_config(node, dbnode("n", allowed), config) is config
    assert operations._node_has_inbound(node, "VMESS_TCP")


def test_unknown_tags_in_db_are_ignored(config):
    node = SimpleNamespace()

    sent = operations._node_config(node, dbnode("n", ["VLESS_TCP", "REMOVED_LATER"]), config)

    assert tags(sent) & USER_TAGS == {"VLESS_TCP"}


def test_users_are_only_pushed_to_nodes_running_the_inbound():
    restricted = SimpleNamespace(allowed_inbounds={"VMESS_TCP"})

    assert operations._node_has_inbound(restricted, "VMESS_TCP")
    assert not operations._node_has_inbound(restricted, "VLESS_TCP")
    assert operations._node_has_inbound(SimpleNamespace(), "VLESS_TCP")  # node object not started yet


def test_unknown_tag_is_rejected():
    with pytest.raises(ValidationError, match="Inbound NOPE doesn't exist"):
        NodeCreate(name="n", address="192.0.2.1", allowed_inbounds=["NOPE"])
    with pytest.raises(ValidationError, match="Inbound NOPE doesn't exist"):
        NodeModify(allowed_inbounds=["VMESS_TCP", "NOPE"])


def test_fallback_inbound_must_come_with_its_fallbacks_inbound():
    with pytest.raises(ValidationError, match="needs the fallbacks inbound FALLBACK_MAIN"):
        NodeCreate(name="n", address="192.0.2.1", allowed_inbounds=["WS_CHILD"])

    node = NodeCreate(name="n", address="192.0.2.1", allowed_inbounds=["WS_CHILD", "FALLBACK_MAIN"])
    assert node.allowed_inbounds == ["WS_CHILD", "FALLBACK_MAIN"]


def test_selection_is_optional_and_deduplicated():
    assert NodeCreate(name="n", address="a").allowed_inbounds is None
    assert NodeCreate(name="n", address="a", allowed_inbounds=["VMESS_TCP", "VMESS_TCP"]).allowed_inbounds == ["VMESS_TCP"]
    assert NodeModify().allowed_inbounds is None
    assert NodeModify(allowed_inbounds=[]).allowed_inbounds == []


def test_response_accepts_tags_that_left_the_core_config():
    response = NodeResponse(id=1, name="n", address="a", status="connected", allowed_inbounds=["GONE"])

    assert response.allowed_inbounds == ["GONE"]


@pytest.fixture
def db():
    Base.metadata.create_all(engine)
    with GetDB() as session:
        yield session
    Base.metadata.drop_all(engine)


def test_crud_saves_changes_and_clears_the_selection(db):
    node = crud.create_node(db, NodeCreate(name="a", address="192.0.2.1", allowed_inbounds=["VMESS_TCP"]))
    plain = crud.create_node(db, NodeCreate(name="b", address="192.0.2.2", allowed_inbounds=[]))

    assert crud.get_node_by_id(db, node.id).allowed_inbounds == ["VMESS_TCP"]
    assert plain.allowed_inbounds is None

    crud.update_node(db, node, NodeModify(name="a2"))  # field not sent: selection unchanged
    assert node.allowed_inbounds == ["VMESS_TCP"]

    crud.update_node(db, node, NodeModify(allowed_inbounds=["VLESS_TCP", "TROJAN_TCP"]))
    assert crud.get_node_by_id(db, node.id).allowed_inbounds == ["VLESS_TCP", "TROJAN_TCP"]

    crud.update_node(db, node, NodeModify(allowed_inbounds=[]))
    assert crud.get_node_by_id(db, node.id).allowed_inbounds is None
    assert NodeResponse.model_validate(node).allowed_inbounds is None


def test_inbounds_picked_for_nodes_leave_the_main_core(db):
    crud.create_node(db, NodeCreate(name="a", address="192.0.2.1", allowed_inbounds=["VMESS_TCP"]))
    crud.create_node(db, NodeCreate(name="b", address="192.0.2.2"))  # runs everything, claims nothing
    disabled = crud.create_node(db, NodeCreate(name="c", address="192.0.2.3",
                                               allowed_inbounds=["VLESS_TCP", "VMESS_TCP"]))
    crud.update_node(db, disabled, NodeModify(status="disabled"))

    assert operations.node_only_inbounds() == {"VMESS_TCP", "VLESS_TCP"}


def test_api_only_keeps_nothing_clients_can_reach(config):
    before = config.to_json()

    assert tags(config.api_only()) == {"API_INBOUND"}
    assert config.to_json() == before


def test_main_core_leaves_out_every_inbound_by_default(db, monkeypatch):
    crud.create_node(db, NodeCreate(name="a", address="192.0.2.1", allowed_inbounds=["VMESS_TCP"]))

    assert operations.MAIN_CORE_INBOUNDS == "none"
    assert operations.main_core_left_out(xray.config) == set(xray.config.inbounds_by_tag)

    monkeypatch.setattr(operations, "MAIN_CORE_INBOUNDS", "auto")
    assert operations.main_core_left_out(xray.config) == {"VMESS_TCP"}


class FakePopen:
    """Stands in for the xray process and keeps the config written to its stdin."""
    written = None

    def __init__(self, *args, **kwargs):
        self.stdin = SimpleNamespace(write=self.write, flush=lambda: None, close=lambda: None)
        self.stdout = SimpleNamespace(readline=lambda: "")

    def write(self, text):
        FakePopen.written = json.loads(text)

    def poll(self):
        return 0  # "exited", so the log reader thread stops at once

    def terminate(self):
        pass


@pytest.mark.parametrize("mode, expected", [
    ("none", {"API_INBOUND"}),  # no inbound at all, not even the ones Marzban doesn't manage
    ("auto", {"API_INBOUND", "EXTRA_DOKO", "VLESS_TCP", "TROJAN_TCP", "FALLBACK_MAIN", "WS_CHILD"}),
])
def test_main_core_starts_with_the_right_inbounds(db, monkeypatch, mode, expected):
    from app.xray import core as core_module
    from config import XRAY_ASSETS_PATH, XRAY_EXECUTABLE_PATH

    crud.create_node(db, NodeCreate(name="a", address="192.0.2.1", allowed_inbounds=["VMESS_TCP"]))
    monkeypatch.setattr(core_module, "MAIN_CORE_INBOUNDS", mode)
    monkeypatch.setattr(operations, "MAIN_CORE_INBOUNDS", mode)
    monkeypatch.setattr(core_module.subprocess, "Popen", FakePopen)
    core = core_module.XRayCore(XRAY_EXECUTABLE_PATH, XRAY_ASSETS_PATH)

    core.start(xray.config.include_db_users())

    assert {i["tag"] for i in FakePopen.written["inbounds"]} == expected
    assert core.excluded_inbounds == ({"VMESS_TCP"} if mode == "auto" else set(xray.config.inbounds_by_tag))


def test_users_skip_the_main_core_for_node_only_inbounds(monkeypatch):
    monkeypatch.setattr(xray.core, "excluded_inbounds", {"VMESS_TCP"})

    assert not operations._core_has_inbound("VMESS_TCP")
    assert operations._core_has_inbound("VLESS_TCP")


def test_add_as_new_host_only_covers_the_nodes_inbounds(db):
    def tags_with_host(address):
        return {tag for tag in xray.config.inbounds_by_tag
                if any(host.address == address for host in crud.get_hosts(db, tag))}

    add_host_if_needed(NodeCreate(name="a", address="192.0.2.50", allowed_inbounds=["VMESS_TCP"]), db)
    add_host_if_needed(NodeCreate(name="b", address="192.0.2.51"), db)
    add_host_if_needed(NodeCreate(name="c", address="192.0.2.52", add_as_new_host=False), db)

    assert tags_with_host("192.0.2.50") == {"VMESS_TCP"}
    assert tags_with_host("192.0.2.51") == set(xray.config.inbounds_by_tag)
    assert tags_with_host("192.0.2.52") == set()
