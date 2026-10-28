"""Backend parts of the graphical core editor: Xray checks a config before it is saved, REALITY keys.

Run inside the Marzban image (it has xray and its geo files), like test_node_allowed_inbounds.py.
"""
import pytest
from fastapi import HTTPException

from app import xray
from app.routers import core as core_router


def test_xray_accepts_the_current_config():
    core_router.check_xray_config(xray.config.copy())


def test_xray_accepts_the_routing_presets():
    config = xray.config.copy()
    config["routing"]["rules"] += [
        {"type": "field", "domain": ["geosite:category-ads-all"], "outboundTag": "BLOCK"},
        {"type": "field", "protocol": ["bittorrent"], "outboundTag": "BLOCK"},
        {"type": "field", "domain": ["geosite:category-ir", "regexp:.*\\.ir$"], "outboundTag": "DIRECT"},
        {"type": "field", "ip": ["geoip:ir", "geoip:private"], "outboundTag": "BLOCK"},
    ]

    core_router.check_xray_config(config)


def test_xray_rejects_what_it_cannot_load():
    config = xray.config.copy()
    config["outbounds"].append({"tag": "BROKEN", "protocol": "no-such-protocol"})

    with pytest.raises(ValueError, match="Xray rejected the config"):
        core_router.check_xray_config(config)


def test_reality_keys():
    keys = core_router.get_reality_keys(admin=None)

    assert keys["private_key"] and keys["public_key"]
    assert core_router.get_reality_keys(private_key=keys["private_key"], admin=None) == keys
    with pytest.raises(HTTPException):
        core_router.get_reality_keys(private_key="not-a-key", admin=None)
