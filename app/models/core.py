from pydantic import BaseModel


class CoreStats(BaseModel):
    version: str
    started: bool
    logs_websocket: str


class RealityKeys(BaseModel):
    private_key: str
    public_key: str
