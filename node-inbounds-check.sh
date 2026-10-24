#!/usr/bin/env bash
# Shows, for every inbound, where it should run (main server / each node) and where it really
# listens, plus where the subscription hosts of that inbound point. Changes nothing.
#
#   bash node-inbounds-check.sh            (on the main server, as root)
#
#   MARZBAN_DIR        folder with docker-compose.yml (default /opt/marzban)
#   MARZBAN_CONTAINER  container name or id to use instead of "docker compose ps -q marzban"
set -u

dir=${MARZBAN_DIR:-/opt/marzban}
c=${MARZBAN_CONTAINER:-$(cd "$dir" 2>/dev/null && docker compose ps -q marzban 2>/dev/null)}
if [ -z "$c" ] || ! docker inspect "$c" >/dev/null 2>&1; then
  echo "Marzban container not found: is it running? (set MARZBAN_DIR or MARZBAN_CONTAINER)"
  exit 1
fi

echo "== image: $(docker inspect -f '{{.Config.Image}}' "$c")"
if docker exec "$c" grep -q excluded_inbounds /code/app/xray/core.py 2>/dev/null; then
  echo "== per-node inbound code: present"
else
  echo "== per-node inbound code: MISSING - this container runs an image without the feature"
fi
echo "== database revision: $(docker exec "$c" alembic current 2>/dev/null | tail -n 1)"
local_nodes=$(docker ps --format '{{.Names}} ({{.Image}})' | grep -i 'marzban-node')
if [ -n "$local_nodes" ]; then
  echo "== marzban-node also runs on THIS machine: $local_nodes"
fi

docker exec -i -e MAIN_IPS="$(hostname -I 2>/dev/null)" "$c" python3 - <<'PY'
import json
import os
import socket
import sys
from concurrent.futures import ThreadPoolExecutor

import config
from sqlalchemy import create_engine, inspect, text

sys.stdout.reconfigure(errors="replace")
PROXIES = {"vmess", "vless", "trojan", "shadowsocks"}
UDP_NETWORKS = {"kcp", "mkcp", "quic"}
problems, notes = [], []


def load_xray_config():
    try:
        import commentjson as loader
    except ImportError:
        loader = json
    raw = config.XRAY_JSON
    if os.path.isfile(raw):
        with open(raw, encoding="utf-8-sig") as f:
            raw = f.read()
    return loader.loads(raw)


def resolve(address):
    address = address.strip().strip("[]")
    if address.startswith("*."):
        address = "x" + address[1:]
    try:
        return {info[4][0] for info in socket.getaddrinfo(address, None)}
    except (OSError, UnicodeError):
        return set()


def tags_of(value):
    if isinstance(value, str):
        value = json.loads(value)
    return set(value) if value else None


def main_core_ports():
    """TCP ports the Xray processes of this container listen on, None if no Xray runs."""
    ports, found = set(), False
    for pid in filter(str.isdigit, os.listdir("/proc")):
        try:
            with open(f"/proc/{pid}/comm") as f:
                if f.read().strip() != "xray":
                    continue
            inodes = set()
            for fd in os.listdir(f"/proc/{pid}/fd"):
                try:
                    link = os.readlink(f"/proc/{pid}/fd/{fd}")
                except OSError:
                    continue
                if link.startswith("socket:["):
                    inodes.add(link[8:-1])
        except OSError:
            continue
        found = True
        for name in ("tcp", "tcp6"):
            try:
                with open(f"/proc/{pid}/net/{name}") as f:
                    lines = f.read().splitlines()[1:]
            except OSError:
                continue
            for line in lines:
                fields = line.split()
                if fields[3] == "0A" and fields[9] in inodes:
                    ports.add(int(fields[1].rsplit(":", 1)[1], 16))
    return ports if found else None


def tcp_open(host, port):
    try:
        with socket.create_connection((host.strip("[]"), port), timeout=3):
            return True
    except OSError:
        return False


inbounds = []
for inbound in load_xray_config().get("inbounds", []):
    tag = inbound.get("tag")
    if not tag:
        continue
    listen = str(inbound.get("listen") or "0.0.0.0")
    try:
        port = int(inbound.get("port"))
    except (TypeError, ValueError):
        port = None  # unix socket, port range or env value
    network = (inbound.get("streamSettings") or {}).get("network") or "tcp"
    inbounds.append({
        "tag": tag,
        "protocol": inbound.get("protocol"),
        "network": network,
        "port": port,
        "managed": inbound.get("protocol") in PROXIES and tag not in config.XRAY_EXCLUDE_INBOUND_TAGS,
        "public": not (listen.startswith(("127.", "@", "/")) or listen in ("localhost", "::1")),
        "tcp": network not in UDP_NETWORKS,
    })

engine = create_engine(config.SQLALCHEMY_DATABASE_URL)
with engine.connect() as db:
    has_column = "allowed_inbounds" in {col["name"] for col in inspect(db).get_columns("nodes")}
    node_rows = db.execute(text(
        "SELECT id, name, address, status" + (", allowed_inbounds" if has_column else "")
        + " FROM nodes ORDER BY id")).fetchall()
    host_rows = db.execute(text(
        "SELECT inbound_tag, remark, address, port, is_disabled FROM hosts ORDER BY id")).fetchall()

main_ips = set(os.environ.get("MAIN_IPS", "").split()) | {"127.0.0.1", "::1"}
nodes = []
for row in node_rows:
    ips = resolve(row.address)
    nodes.append({
        "name": row.name,
        "address": row.address,
        "status": str(row.status).split(".")[-1],
        "allowed": tags_of(row.allowed_inbounds) if has_column else None,
        "ips": ips,
        "on_main": bool(ips & main_ips),
    })

left_out = set().union(*(n["allowed"] or set() for n in nodes)) if has_column else set()
main_ports = main_core_ports()

print("== main server IPs:", " ".join(sorted(main_ips - {"127.0.0.1", "::1"})) or "unknown")
if not has_column:
    print("!! nodes.allowed_inbounds column is missing: the migration did not run")
print("== nodes")
for n in nodes:
    if n["allowed"] is None:
        picked = "ALL inbounds (stored as null: the main server keeps every inbound for this node)"
    else:
        picked = ", ".join(sorted(n["allowed"]))
    print(f'   "{n["name"]}"  status={n["status"]}  inbounds: {picked}')
    if n["on_main"]:
        print(f'      !! the address of "{n["name"]}" ({n["address"]}) is this main server itself')
        notes.append(f'node "{n["name"]}" points at the main server, so its ports can\'t be told apart from the main server\'s')
print("== main server leaves out:", ", ".join(sorted(left_out)) or "nothing")
if main_ports is None:
    print("!! no Xray process runs in the Marzban container (main core is down)")

with ThreadPoolExecutor(max_workers=32) as pool:
    probes = {
        (n["name"], i["tag"]): pool.submit(tcp_open, n["address"], i["port"])
        for n in nodes for i in inbounds if i["port"] and i["public"] and i["tcp"]
    }
    probes = {key: future.result() for key, future in probes.items()}


def node_runs(n, tag):
    return n["allowed"] is None or tag in n["allowed"]


print("== inbounds: should run / really listens (probed from this server)")
for i in inbounds:
    tag = i["tag"]
    port = i["port"] if i["port"] else "no port"
    print(f'{tag}  ({i["protocol"]}, {i["network"]}, {port})')
    if not i["managed"]:
        print("   not a user inbound: runs on the main server and on every node")
        continue
    should = tag not in left_out
    if main_ports is None or not i["port"] or not i["tcp"]:
        really = "not checked"
    else:
        really = "listening" if i["port"] in main_ports else "not listening"
    flag = ""
    if really != "not checked" and should != (really == "listening"):
        flag = "   <-- PROBLEM"
        problems.append(f'{tag} on the main server: should {"" if should else "not "}run, but is {really}')
    print(f'   main server{" " * 10}should: {"yes" if should else "no "}   really: {really}{flag}')
    for n in nodes:
        label = f'node "{n["name"]}"'
        if n["status"] == "disabled":
            should, why = False, " (node disabled)"
        else:
            should, why = node_runs(n, tag), ""
        result = probes.get((n["name"], tag))
        really = "not checked" if result is None else ("open" if result else "closed")
        flag = ""
        if result is not None and not n["on_main"] and should != result:
            if n["status"] in ("connected", "disabled"):
                flag = "   <-- PROBLEM"
                problems.append(f'{tag} on {label}: should {"" if should else "not "}run{why}, but the port is {really}')
            else:
                flag = f'   (node is {n["status"]})'
        print(f'   {label:<20} should: {"yes" if should else "no "}   really: {really}{why}{flag}')

print("== subscription hosts (where each link connects)")
host_tags = {i["tag"]: i for i in inbounds}
for row in host_rows:
    inbound = host_tags.get(row.inbound_tag)
    targets = []
    for address in row.address.split(","):
        address = address.strip()
        if address in ("{SERVER_IP}", "{SERVER_IPV6}"):
            targets.append(("main server", row.inbound_tag not in left_out))
            continue
        ips = resolve(address)
        node = next((n for n in nodes if n["address"] == address or ips & n["ips"]), None)
        if node:
            runs = node["status"] != "disabled" and node_runs(node, row.inbound_tag)
            targets.append((f'node "{node["name"]}"', runs))
        elif ips & main_ips:
            targets.append(("main server", row.inbound_tag not in left_out))
        else:
            targets.append((f"other address {address}", None))
    port = row.port or (inbound["port"] if inbound else None)
    off = " [host disabled]" if row.is_disabled else ""
    for where, runs in targets:
        mark = ""
        if runs is False and not row.is_disabled:
            mark = "   (that server doesn't run this inbound: the link fails)"
            notes.append(f'host "{row.remark}" of {row.inbound_tag} -> {where}: that server doesn\'t run it')
        print(f'   {row.inbound_tag}: "{row.remark}" -> {where} :{port}{off}{mark}')

print("== result")
for line in problems:
    print("PROBLEM:", line)
for line in notes:
    print("note:", line)
if not problems:
    print("no problems found")
PY

echo "== panel log (newest lines about inbounds)"
docker logs --tail 5000 "$c" 2>&1 | grep -E "Main core leaves out|gets only these inbounds|Unable to start|Traceback" | tail -n 8
