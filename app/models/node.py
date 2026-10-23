from enum import Enum
from typing import List, Optional

from pydantic import ConfigDict, BaseModel, Field, field_validator


def validate_inbound_tags(tags: Optional[List[str]]) -> Optional[List[str]]:
    # empty or missing selection means the node gets every inbound
    if not tags:
        return tags

    from app import xray
    from config import XRAY_FALLBACKS_INBOUND_TAG
    for tag in tags:
        if tag not in xray.config.inbounds_by_tag:
            raise ValueError(f"Inbound {tag} doesn't exist")

        # an inbound without its own port is only reachable through the fallbacks inbound
        if (xray.config.inbounds_by_tag[tag]["is_fallback"]
                and XRAY_FALLBACKS_INBOUND_TAG in xray.config.inbounds_by_tag
                and XRAY_FALLBACKS_INBOUND_TAG not in tags):
            raise ValueError(f"Inbound {tag} needs the fallbacks inbound {XRAY_FALLBACKS_INBOUND_TAG}")

    return list(dict.fromkeys(tags))


class NodeStatus(str, Enum):
    connected = "connected"
    connecting = "connecting"
    error = "error"
    disabled = "disabled"


class NodeSettings(BaseModel):
    min_node_version: str = "v0.2.0"
    certificate: str


class Node(BaseModel):
    name: str
    address: str
    port: int = 62050
    api_port: int = 62051
    usage_coefficient: float = Field(gt=0, default=1.0)
    allowed_inbounds: Optional[List[str]] = None


class NodeCreate(Node):
    add_as_new_host: bool = True
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "name": "DE node",
            "address": "192.168.1.1",
            "port": 62050,
            "api_port": 62051,
            "add_as_new_host": True,
            "usage_coefficient": 1,
            "allowed_inbounds": []
        }
    })

    @field_validator("allowed_inbounds")
    def validate_allowed_inbounds(cls, tags):
        return validate_inbound_tags(tags)


class NodeModify(Node):
    name: Optional[str] = Field(None, nullable=True)
    address: Optional[str] = Field(None, nullable=True)
    port: Optional[int] = Field(None, nullable=True)
    api_port: Optional[int] = Field(None, nullable=True)
    status: Optional[NodeStatus] = Field(None, nullable=True)
    usage_coefficient: Optional[float] = Field(None, nullable=True)
    allowed_inbounds: Optional[List[str]] = Field(None, nullable=True)
    model_config = ConfigDict(json_schema_extra={
        "example": {
            "name": "DE node",
            "address": "192.168.1.1",
            "port": 62050,
            "api_port": 62051,
            "status": "disabled",
            "usage_coefficient": 1.0,
            "allowed_inbounds": []
        }
    })

    @field_validator("allowed_inbounds")
    def validate_allowed_inbounds(cls, tags):
        return validate_inbound_tags(tags)


class NodeResponse(Node):
    id: int
    xray_version: Optional[str] = None
    status: NodeStatus
    message: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class NodeUsageResponse(BaseModel):
    node_id: Optional[int] = None
    node_name: str
    uplink: int
    downlink: int


class NodesUsageResponse(BaseModel):
    usages: List[NodeUsageResponse]
