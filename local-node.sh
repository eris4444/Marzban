#!/usr/bin/env bash
# Runs marzban-node on the panel server itself and adds it to the panel, so configs that point at
# this server (the default {SERVER_IP} hosts) keep working while the panel's own Xray core runs no
# inbounds (MAIN_CORE_INBOUNDS=none). Running it again reuses what is already there.
#
#   bash local-node.sh                                         node "local" with every inbound
#   INBOUNDS="VLESS TCP REALITY,VMESS WS" bash local-node.sh   only these inbounds (comma separated)
#
# Settings (environment variables):
#   NODE_NAME=local  INBOUNDS=  NODE_DIR=/opt/marzban-node  NODE_DATA=/var/lib/marzban-node
#   SERVICE_PORT=62050  XRAY_API_PORT=62051  NODE_IMAGE=gozargah/marzban-node:latest
#   MARZBAN_DIR=/opt/marzban  MARZBAN_CONTAINER=<name or id, instead of docker compose ps>
set -euo pipefail

NODE_NAME=${NODE_NAME:-local}
INBOUNDS=${INBOUNDS:-}
NODE_DIR=${NODE_DIR:-/opt/marzban-node}
NODE_DATA=${NODE_DATA:-/var/lib/marzban-node}
SERVICE_PORT=${SERVICE_PORT:-62050}
XRAY_API_PORT=${XRAY_API_PORT:-62051}
NODE_IMAGE=${NODE_IMAGE:-gozargah/marzban-node:latest}
# the same marzban-node image, kept next to this project's panel image for servers without Docker Hub
MIRROR_IMAGE=${MIRROR_IMAGE:-ghcr.io/eris4444/marzban:marzban-node}
MARZBAN_DIR=${MARZBAN_DIR:-/opt/marzban}

die() { echo "ERROR: $*" >&2; exit 1; }
port_open() { timeout 2 bash -c "exec 3<>/dev/tcp/127.0.0.1/$1" 2>/dev/null; }

c=${MARZBAN_CONTAINER:-$(cd "$MARZBAN_DIR" 2>/dev/null && docker compose ps -q marzban 2>/dev/null || true)}
if [ -z "$c" ] || ! docker inspect "$c" >/dev/null 2>&1; then
  die "Marzban container not found: is the panel running? (set MARZBAN_DIR or MARZBAN_CONTAINER)"
fi

echo "== 1/5 checking the panel"
mode=$(docker exec "$c" python3 -c "import config; print(getattr(config, 'MAIN_CORE_INBOUNDS', 'missing'))") ||
  die "can't read the panel settings"
case $mode in
  none) ;;
  missing) die "the panel runs an image without MAIN_CORE_INBOUNDS: update the panel image first" ;;
  *) die "MAIN_CORE_INBOUNDS=$mode: the panel's own core still runs inbounds and would take the ports a
       local node needs. Remove MAIN_CORE_INBOUNDS from $MARZBAN_DIR/.env (or set it to none),
       run 'docker compose up -d' in $MARZBAN_DIR, then run this again." ;;
esac
if [ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$c")" != host ]; then
  die "the panel container must use network_mode: host to reach a node on 127.0.0.1"
fi
cert=$(docker exec "$c" python3 -c "
import config
from sqlalchemy import create_engine, text
with create_engine(config.SQLALCHEMY_DATABASE_URL).connect() as db:
    print(db.execute(text('SELECT certificate FROM tls LIMIT 1')).scalar() or '')
")
[ -n "$cert" ] || die "the panel has no node certificate yet (open Nodes in the dashboard once)"

echo "== 2/5 marzban-node on this server"
# a node container already running here in host network mode is reused through its compose folder
for id in $(docker ps -q); do
  if [ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$id")" = host ] &&
    [[ $(docker inspect -f '{{.Config.Image}}' "$id") == *marzban-node* ]]; then
    folder=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$id")
    [ -n "$folder" ] || die "marzban-node container $(docker inspect -f '{{.Name}}' "$id") runs without
       docker compose; add it in the panel yourself with address 127.0.0.1"
    NODE_DIR=$folder
    break
  fi
done

compose=$NODE_DIR/docker-compose.yml
if [ -f "$compose" ]; then
  echo "   using the existing $compose"
  p=$(grep -oE 'SERVICE_PORT["]?[:=][[:space:]]*"?[0-9]+' "$compose" | grep -oE '[0-9]+$' | head -n 1 || true)
  [ -n "$p" ] && SERVICE_PORT=$p
  p=$(grep -oE 'XRAY_API_PORT["]?[:=][[:space:]]*"?[0-9]+' "$compose" | grep -oE '[0-9]+$' | head -n 1 || true)
  [ -n "$p" ] && XRAY_API_PORT=$p
else
  for p in "$SERVICE_PORT" "$XRAY_API_PORT"; do
    if port_open "$p"; then die "port $p is already in use on this server (set SERVICE_PORT / XRAY_API_PORT)"; fi
  done
  image=$NODE_IMAGE
  if ! docker image inspect "$image" >/dev/null 2>&1 && ! docker pull -q "$image" >/dev/null; then
    echo "   $image can't be pulled, using $MIRROR_IMAGE"
    image=$MIRROR_IMAGE
    docker pull -q "$image" >/dev/null || die "can't pull $NODE_IMAGE or $MIRROR_IMAGE"
  fi
  mkdir -p "$NODE_DIR" "$NODE_DATA"
  printf '%s\n' "$cert" >"$NODE_DATA/ssl_client_cert.pem"
  # the service and the Xray API listen on 127.0.0.1 only: just this panel talks to them
  cat >"$compose" <<EOF
services:
  marzban-node:
    image: $image
    restart: always
    network_mode: host
    environment:
      SERVICE_HOST: "127.0.0.1"
      SERVICE_PORT: "$SERVICE_PORT"
      XRAY_API_HOST: "127.0.0.1"
      XRAY_API_PORT: "$XRAY_API_PORT"
      SERVICE_PROTOCOL: "rest"
      SSL_CLIENT_CERT_FILE: "/var/lib/marzban-node/ssl_client_cert.pem"
    volumes:
      - $NODE_DATA:/var/lib/marzban-node
EOF
  echo "   wrote $compose"
fi
(cd "$NODE_DIR" && docker compose up -d >/dev/null)
node_container=$(cd "$NODE_DIR" && docker compose ps -q | head -n 1)
[ -n "$node_container" ] || die "marzban-node did not start: cd $NODE_DIR && docker compose logs"
for _ in $(seq 30); do
  [ "$(docker inspect -f '{{.State.Running}}' "$node_container")" = true ] && break
  sleep 1
done

# the node must trust this panel's certificate
cert_file=$(docker exec "$node_container" printenv SSL_CLIENT_CERT_FILE || true)
if [ -n "$cert_file" ] && [ "$(docker exec "$node_container" cat "$cert_file" 2>/dev/null)" != "$cert" ]; then
  echo "   the node trusts another certificate: replacing it with this panel's (old one kept as .bak)"
  docker exec "$node_container" sh -c "cp '$cert_file' '$cert_file.bak' 2>/dev/null; true"
  printf '%s\n' "$cert" | docker exec -i "$node_container" sh -c "cat > '$cert_file'"
  docker restart "$node_container" >/dev/null
fi

echo "== 3/5 waiting for the node service on 127.0.0.1:$SERVICE_PORT"
for _ in $(seq 90); do port_open "$SERVICE_PORT" && break; sleep 2; done
port_open "$SERVICE_PORT" || die "nothing listens on 127.0.0.1:$SERVICE_PORT: cd $NODE_DIR && docker compose logs"

echo "== 4/5 adding it to the panel"
docker exec -i -e NODE_NAME="$NODE_NAME" -e INBOUNDS="$INBOUNDS" -e SERVICE_PORT="$SERVICE_PORT" \
  -e XRAY_API_PORT="$XRAY_API_PORT" -e MAIN_IPS="$(hostname -I 2>/dev/null)" "$c" python3 - <<'PY'
import http.client
import json
import os
import socket
import ssl
import sys
import time
from datetime import datetime, timedelta

import jwt
import config
from sqlalchemy import create_engine, text

name = os.environ["NODE_NAME"]
inbounds = [tag.strip() for tag in os.environ["INBOUNDS"].split(",") if tag.strip()]
port, api_port = int(os.environ["SERVICE_PORT"]), int(os.environ["XRAY_API_PORT"])

# a short-lived sudo token signed with the panel's own key: root on this server needs no password
with create_engine(config.SQLALCHEMY_DATABASE_URL).connect() as db:
    secret = db.execute(text("SELECT secret_key FROM jwt LIMIT 1")).scalar()
    admin = db.execute(text("SELECT username FROM admins WHERE is_sudo = :yes ORDER BY id LIMIT 1"),
                       {"yes": True}).scalar()
admin = admin or next(iter(config.SUDOERS), None)
if not admin:
    sys.exit("ERROR: no sudo admin exists in the panel")
now = datetime.utcnow()
token = jwt.encode({"sub": admin, "access": "sudo", "iat": now, "exp": now + timedelta(minutes=10)},
                   secret, algorithm="HS256")

# reach the API the way main.py binds it: unix socket, or 127.0.0.1 / UVICORN_HOST, TLS when set
use_tls = bool(config.UVICORN_SSL_CERTFILE and config.UVICORN_SSL_KEYFILE)
uds = None if config.DEBUG else config.UVICORN_UDS
host = "127.0.0.1"
if use_tls and not config.DEBUG and config.UVICORN_HOST not in ("0.0.0.0", "::", ""):
    host = config.UVICORN_HOST


class Connection(http.client.HTTPConnection):
    def connect(self):
        if uds:
            self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.sock.settimeout(30)
            self.sock.connect(uds)
        else:
            self.sock = socket.create_connection((host, config.UVICORN_PORT), timeout=30)
        if use_tls:
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE  # this panel itself, over loopback
            self.sock = context.wrap_socket(self.sock)


def api(method, path, body=None):
    conn = Connection("localhost")
    headers = {"Authorization": f"Bearer {token}"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    conn.request(method, "/api" + path, json.dumps(body) if body is not None else None, headers)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    try:
        data = json.loads(data)
    except ValueError:
        pass
    return res.status, data


status, nodes = api("GET", "/nodes")
if status != 200:
    sys.exit(f"ERROR: the panel API answered {status}: {nodes}")

local_addresses = {"127.0.0.1", "localhost", "::1"} | set(os.environ.get("MAIN_IPS", "").split())
node = next((n for n in nodes if n["address"] in local_addresses and n["port"] == port), None)
if node:
    print(f'   node "{node["name"]}" ({node["address"]}:{port}) is already in the panel')
    if inbounds:
        status, node = api("PUT", f'/node/{node["id"]}', {"allowed_inbounds": inbounds})
        if status != 200:
            sys.exit(f"ERROR: the panel refused the inbounds ({status}): {node}")
        print(f'   its inbounds are now: {", ".join(node["allowed_inbounds"])}')
    elif node["status"] not in ("connected", "disabled"):
        api("POST", f'/node/{node["id"]}/reconnect')
else:
    if any(n["name"] == name for n in nodes):
        sys.exit(f'ERROR: another node is already called "{name}": run again with NODE_NAME=<other name>')
    status, node = api("POST", "/node", {
        "name": name,
        "address": "127.0.0.1",
        "port": port,
        "api_port": api_port,
        "usage_coefficient": 1,
        "add_as_new_host": False,  # the default {SERVER_IP} hosts already point at this server
        "allowed_inbounds": inbounds or None,
    })
    if status != 200:
        sys.exit(f"ERROR: the panel refused the node ({status}): {node}")
    print(f'   added node "{name}" (127.0.0.1:{port}, API port {api_port})')

if node["status"] == "disabled":
    print("   the node is disabled in the panel: enable it there to serve configs")
    sys.exit(0)

print("== 5/5 waiting for the panel to connect")
for _ in range(60):
    status, node = api("GET", f'/node/{node["id"]}')
    if node.get("status") == "connected":
        break
    time.sleep(2)
if node.get("status") != "connected":
    sys.exit(f'ERROR: node "{node["name"]}" is {node.get("status")}: {node.get("message")}')
print(f'   node "{node["name"]}" is connected (Xray {node.get("xray_version")})')
print("   inbounds on this server:", ", ".join(node["allowed_inbounds"] or []) or "all of them")
PY
