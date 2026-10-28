import asyncio
import json
import subprocess
import time
from typing import Optional

import commentjson
from fastapi import APIRouter, Depends, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect

from app import xray
from app.db import Session, get_db
from app.models.admin import Admin
from app.models.core import CoreStats, RealityKeys
from app.utils import responses
from app.xray import XRayConfig
from config import XRAY_ASSETS_PATH, XRAY_EXECUTABLE_PATH, XRAY_JSON

router = APIRouter(tags=["Core"], prefix="/api", responses={401: responses._401})


def check_xray_config(config: XRayConfig):
    """Let Xray itself load the config ("run -test" opens no port) before any core gets it."""
    try:
        result = subprocess.run(
            [XRAY_EXECUTABLE_PATH, "run", "-test", "-config", "stdin:"],
            input=config.to_json(),
            capture_output=True,
            text=True,
            timeout=60,
            env={"XRAY_LOCATION_ASSET": XRAY_ASSETS_PATH},
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ValueError(f"Xray couldn't check the config: {exc}")
    if result.returncode != 0:
        lines = [line.strip() for line in (result.stdout + result.stderr).splitlines() if line.strip()]
        raise ValueError(f"Xray rejected the config: {lines[-1] if lines else 'unknown error'}")


@router.websocket("/core/logs")
async def core_logs(websocket: WebSocket, db: Session = Depends(get_db)):
    token = websocket.query_params.get("token") or websocket.headers.get(
        "Authorization", ""
    ).removeprefix("Bearer ")
    admin = Admin.get_admin(token, db)
    if not admin:
        return await websocket.close(reason="Unauthorized", code=4401)

    if not admin.is_sudo:
        return await websocket.close(reason="You're not allowed", code=4403)

    interval = websocket.query_params.get("interval")
    if interval:
        try:
            interval = float(interval)
        except ValueError:
            return await websocket.close(reason="Invalid interval value", code=4400)
        if interval > 10:
            return await websocket.close(
                reason="Interval must be more than 0 and at most 10 seconds", code=4400
            )

    await websocket.accept()

    cache = ""
    last_sent_ts = 0
    with xray.core.get_logs() as logs:
        while True:
            if interval and time.time() - last_sent_ts >= interval and cache:
                try:
                    await websocket.send_text(cache)
                except (WebSocketDisconnect, RuntimeError):
                    break
                cache = ""
                last_sent_ts = time.time()

            if not logs:
                try:
                    await asyncio.wait_for(websocket.receive(), timeout=0.2)
                    continue
                except asyncio.TimeoutError:
                    continue
                except (WebSocketDisconnect, RuntimeError):
                    break

            log = logs.popleft()

            if interval:
                cache += f"{log}\n"
                continue

            try:
                await websocket.send_text(log)
            except (WebSocketDisconnect, RuntimeError):
                break


@router.get("/core", response_model=CoreStats)
def get_core_stats(admin: Admin = Depends(Admin.get_current)):
    """Retrieve core statistics such as version and uptime."""
    return CoreStats(
        version=xray.core.version,
        started=xray.core.started,
        logs_websocket=router.url_path_for("core_logs"),
    )


@router.post("/core/restart", responses={403: responses._403})
def restart_core(admin: Admin = Depends(Admin.check_sudo_admin)):
    """Restart the core and all connected nodes."""
    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)

    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    return {}


@router.get("/core/x25519", response_model=RealityKeys, responses={403: responses._403})
def get_reality_keys(
    private_key: Optional[str] = None, admin: Admin = Depends(Admin.check_sudo_admin)
):
    """A new REALITY key pair, or the public key of the given private key."""
    try:
        keys = xray.core.get_x25519(private_key)
    except subprocess.CalledProcessError:
        keys = None
    if not keys:
        raise HTTPException(status_code=400, detail="Invalid private key")
    return keys


@router.get("/core/config", responses={403: responses._403})
def get_core_config(admin: Admin = Depends(Admin.check_sudo_admin)) -> dict:
    """Get the current core configuration."""
    with open(XRAY_JSON, "r") as f:
        config = commentjson.loads(f.read())

    return config


@router.put("/core/config", responses={403: responses._403})
def modify_core_config(
    payload: dict, admin: Admin = Depends(Admin.check_sudo_admin)
) -> dict:
    """Modify the core configuration and restart the core."""
    try:
        config = XRayConfig(payload, api_port=xray.config.api_port)
        check_xray_config(config)  # a config Xray can't load would take every core down
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err))

    xray.config = config
    with open(XRAY_JSON, "w") as f:
        f.write(json.dumps(payload, indent=4))

    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    xray.hosts.update()

    return payload
