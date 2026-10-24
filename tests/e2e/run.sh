#!/usr/bin/env bash
# End-to-end test for per-node inbound selection (nodes.allowed_inbounds).
#
#   tests/e2e/run.sh <new-image> <sqlite|mysql|mariadb>
#
# 1. installs upstream Marzban ($OLD_IMAGE), adds a user and a node,
# 2. upgrades that same database with <new-image> and proves the old rows are untouched,
# 3. runs four real marzban-node containers (rest and rpyc) with different selections and checks
#    which inbound ports each node really listens on (edit, core restart and reconnect included),
# 4. rolls the database back and starts upstream Marzban on it again.
# Needs docker, curl, jq and python3 on Linux (GitHub's ubuntu runner).
set -uo pipefail

IMAGE=${1:?usage: run.sh <image> <sqlite|mysql|mariadb>}
DB=${2:?usage: run.sh <image> <sqlite|mysql|mariadb>}
OLD_IMAGE=${OLD_IMAGE:-gozargah/marzban:v0.8.4}
NODE_IMAGE=${NODE_IMAGE:-gozargah/marzban-node:latest}
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
API=http://127.0.0.1:8000/api
ALL_PORTS="20001 20002 20003 20004 20006"  # VMESS_TCP VLESS_TCP TROJAN_TCP SS_TCP EXTRA_DOKO
PASS=0
FAIL=0
TOKEN=
# env sudo admin first; a real database admin is created in step 1 so users get an owner
ADMIN_USER=admin
ADMIN_PASS=admin

ok() { echo "  PASS  $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL  $*"; FAIL=$((FAIL + 1)); }
check() { local name=$1; shift; if "$@"; then ok "$name"; else bad "$name"; fi; }

cleanup() {
  docker rm -f panel node-a node-b node-c node-e e2e-db >/dev/null 2>&1
  docker network rm e2e-net >/dev/null 2>&1
  return 0
}

# one-off container on the panel's database and data dir
run_panel() {
  local image=$1; shift
  docker run --rm --network host --env-file "$WORK/env" -e PYTHONPATH=/code \
    -v "$WORK/data:/var/lib/marzban" -v "$HERE:/e2e:ro" -v "$WORK:/out" "$image" "$@"
}

login() {
  local deadline=$((SECONDS + 180))
  TOKEN=
  while [ -z "$TOKEN" ] || [ "$TOKEN" = null ]; do
    if ((SECONDS > deadline)); then
      echo "panel did not come up"; docker logs panel 2>&1 | tail -60; exit 1
    fi
    sleep 2
    TOKEN=$(curl -s -X POST "$API/admin/token" -d "username=$ADMIN_USER&password=$ADMIN_PASS" |
      jq -r .access_token 2>/dev/null)
  done
}

start_panel() {
  docker rm -f panel >/dev/null 2>&1
  docker run -d --name panel --network host --env-file "$WORK/env" \
    -v "$WORK/data:/var/lib/marzban" "$1" >/dev/null
  login
}

# api METHOD PATH [JSON] -> prints the HTTP code, response body goes to $WORK/resp
api() {
  local args=(-s -o "$WORK/resp" -w '%{http_code}' -X "$1" -H "Authorization: Bearer $TOKEN")
  if [ $# -ge 3 ]; then args+=(-H 'Content-Type: application/json' -d "$3"); fi
  curl "${args[@]}" "$API$2"
}
body() { jq -c "$1" "$WORK/resp"; }

wait_db() {
  local deadline=$((SECONDS + 150))
  until run_panel "$IMAGE" python -c \
    "import sqlalchemy, config; sqlalchemy.create_engine(config.SQLALCHEMY_DATABASE_URL).connect()" >/dev/null 2>&1; do
    if ((SECONDS > deadline)); then echo "database did not come up"; exit 1; fi
    sleep 3
  done
}

port_open() { timeout 2 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; }

# expect_ports LABEL IP "ports that must listen" "ports that must not"
expect_ports() {
  local label=$1 ip=$2 open=$3 closed=$4 deadline=$((SECONDS + 90)) wrong p
  while :; do
    wrong=
    for p in $open; do port_open "$ip" "$p" || wrong+=" $p:closed"; done
    for p in $closed; do port_open "$ip" "$p" && wrong+=" $p:open"; done
    if [ -z "$wrong" ]; then ok "$label"; return; fi
    if ((SECONDS > deadline)); then bad "$label (wrong:$wrong)"; return; fi
    sleep 2
  done
}

wait_connected() {
  local deadline=$((SECONDS + 150)) n s missing
  while :; do
    api GET /nodes >/dev/null
    missing=
    for n in "$@"; do
      s=$(jq -r --arg n "$n" '.[] | select(.name == $n) | .status' "$WORK/resp")
      [ "$s" = connected ] || missing+=" $n=$s"
    done
    if [ -z "$missing" ]; then ok "connected: $*"; return 0; fi
    if ((SECONDS > deadline)); then bad "not connected:$missing"; jq . "$WORK/resp"; return 1; fi
    sleep 2
  done
}

log_count() { docker logs panel 2>&1 | grep -cF "$1"; }

# wait_log_more TEXT COUNT_BEFORE
wait_log_more() {
  local deadline=$((SECONDS + 90))
  until (($(log_count "$1") > $2)); do
    if ((SECONDS > deadline)); then return 1; fi
    sleep 1
  done
}

ip_of() { docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$1"; }

cleanup
trap cleanup EXIT

case $DB in
  sqlite)
    DB_URL=sqlite:////var/lib/marzban/db.sqlite3 ;;
  mysql)
    docker run -d --name e2e-db --network host -e MYSQL_ROOT_PASSWORD=e2epass \
      -e MYSQL_DATABASE=marzban mysql:8.0 >/dev/null
    DB_URL=mysql+pymysql://root:e2epass@127.0.0.1:3306/marzban ;;
  mariadb)
    docker run -d --name e2e-db --network host -e MARIADB_ROOT_PASSWORD=e2epass \
      -e MARIADB_DATABASE=marzban mariadb:lts >/dev/null
    DB_URL=mysql+pymysql://root:e2epass@127.0.0.1:3306/marzban ;;
  *)
    echo "unknown database: $DB"; exit 2 ;;
esac

mkdir -p "$WORK/data"
cp "$HERE/xray_config.json" "$WORK/data/xray_config.json"
cat >"$WORK/env" <<EOF
SQLALCHEMY_DATABASE_URL=$DB_URL
XRAY_JSON=/var/lib/marzban/xray_config.json
SUDO_USERNAME=admin
SUDO_PASSWORD=admin
UVICORN_PORT=8000
EOF

USER_JSON='{"username":"%s","proxies":{"vmess":{},"vless":{},"trojan":{},"shadowsocks":{}},"inbounds":{},"status":"active"}'

echo "== [$DB] 1. existing install on $OLD_IMAGE"
wait_db
start_panel "$OLD_IMAGE"
code=$(api POST /admin '{"username":"owner","password":"owner-pass-1","is_sudo":true}')
check "old panel: create sudo admin owner" [ "$code" = 200 ]
ADMIN_USER=owner
ADMIN_PASS=owner-pass-1
login
code=$(api POST /user "$(printf "$USER_JSON" alice)")
check "old panel: create user alice" [ "$code" = 200 ]
code=$(api POST /node '{"name":"old-node","address":"192.0.2.10","add_as_new_host":true}')
check "old panel: create node old-node (+ hosts)" [ "$code" = 200 ]
for _ in $(seq 30); do
  api GET /hosts >/dev/null
  [ "$(jq '[.[][]] | map(select(.address == "192.0.2.10")) | length' "$WORK/resp")" -gt 0 ] && break
  sleep 1
done
docker stop panel >/dev/null
run_panel "$OLD_IMAGE" python /e2e/dump_db.py /out/before.json

echo "== [$DB] 2. upgrade the same database to $IMAGE"
run_panel "$IMAGE" alembic upgrade head >"$WORK/upgrade.log" 2>&1
cat "$WORK/upgrade.log"
check "migration 2b231de97dc3 -> 4c2b9a7e1f36 ran" grep -q "2b231de97dc3 -> 4c2b9a7e1f36" "$WORK/upgrade.log"
run_panel "$IMAGE" python /e2e/dump_db.py /out/after.json
check "old rows unchanged, only an empty nodes.allowed_inbounds column added" \
  python3 "$HERE/compare_db.py" "$WORK/before.json" "$WORK/after.json"

start_panel "$IMAGE"
api GET /nodes >/dev/null
check "old-node has no selection (null)" [ "$(body '.[] | select(.name == "old-node") | .allowed_inbounds')" = null ]
api GET /users >/dev/null
check "user alice still there" [ "$(body '[.users[].username]')" = '["alice"]' ]
expect_ports "main core runs every inbound" 127.0.0.1 "$ALL_PORTS" ""

echo "== [$DB] 3. real nodes with different selections (a, b, c: rest; e: rpyc)"
api GET /node/settings >/dev/null
jq -r .certificate "$WORK/resp" >"$WORK/client.pem"
docker network create e2e-net >/dev/null
for n in a b c e; do
  protocol=rest
  [ "$n" = e ] && protocol=rpyc
  mkdir -p "$WORK/node-$n"
  cp "$WORK/client.pem" "$WORK/node-$n/ssl_client_cert.pem"
  docker run -d --name "node-$n" --network e2e-net -e SERVICE_PROTOCOL=$protocol \
    -e SSL_CLIENT_CERT_FILE=/var/lib/marzban-node/ssl_client_cert.pem \
    -v "$WORK/node-$n:/var/lib/marzban-node" "$NODE_IMAGE" >/dev/null
done
IP_A=$(ip_of node-a); IP_B=$(ip_of node-b); IP_C=$(ip_of node-c); IP_E=$(ip_of node-e)
expect_ports "node services listening" "$IP_A" 62050 ""
expect_ports "node services listening" "$IP_B" 62050 ""
expect_ports "node services listening" "$IP_C" 62050 ""
expect_ports "node services listening (rpyc)" "$IP_E" 62050 ""

code=$(api POST /node "{\"name\":\"node-a\",\"address\":\"$IP_A\",\"add_as_new_host\":false,\"allowed_inbounds\":[\"VMESS_TCP\"]}")
check "create node-a with [VMESS_TCP]" [ "$code" = 200 ]
check "node-a returns its selection" [ "$(body .allowed_inbounds)" = '["VMESS_TCP"]' ]
NODE_A=$(body .id)
code=$(api POST /node "{\"name\":\"node-b\",\"address\":\"$IP_B\",\"add_as_new_host\":false,\"allowed_inbounds\":[\"VLESS_TCP\",\"TROJAN_TCP\",\"VLESS_TCP\"]}")
check "create node-b with [VLESS_TCP, TROJAN_TCP]" [ "$code" = 200 ]
check "node-b selection saved without duplicates" [ "$(body .allowed_inbounds)" = '["VLESS_TCP","TROJAN_TCP"]' ]
NODE_B=$(body .id)
code=$(api POST /node "{\"name\":\"node-c\",\"address\":\"$IP_C\",\"add_as_new_host\":false}")
check "create node-c without a selection" [ "$code" = 200 ]
check "node-c selection is null" [ "$(body .allowed_inbounds)" = null ]
code=$(api POST /node "{\"name\":\"node-e\",\"address\":\"$IP_E\",\"add_as_new_host\":false,\"allowed_inbounds\":[\"TROJAN_TCP\"]}")
check "create rpyc node-e with [TROJAN_TCP]" [ "$code" = 200 ]
NODE_E=$(body .id)

code=$(api POST /node '{"name":"bad","address":"192.0.2.20","allowed_inbounds":["NOPE"]}')
check "unknown tag rejected on create (422)" [ "$code" = 422 ]
check "error names the field" grep -q "Inbound NOPE doesn't exist" "$WORK/resp"
code=$(api PUT "/node/$NODE_A" '{"allowed_inbounds":["VMESS_TCP","NOPE"]}')
check "unknown tag rejected on edit (422)" [ "$code" = 422 ]
api GET /nodes >/dev/null
check "rejected requests added no node" [ "$(body '[.[].name] | sort')" = '["node-a","node-b","node-c","node-e","old-node"]' ]
check "rejected edit kept node-a's selection" \
  [ "$(body '.[] | select(.name == "node-a") | .allowed_inbounds')" = '["VMESS_TCP"]' ]

# tags that have a host with this address
hosts_for() {
  api GET /hosts >/dev/null
  jq -c --arg a "$1" '[to_entries[] | select(any(.value[]; .address == $a)) | .key]' "$WORK/resp"
}
code=$(api POST /node '{"name":"node-d","address":"192.0.2.30","add_as_new_host":true,"allowed_inbounds":["VMESS_TCP"]}')
check "create node-d with [VMESS_TCP] and add_as_new_host" [ "$code" = 200 ]
NODE_D=$(body .id)
for _ in $(seq 30); do [ "$(hosts_for 192.0.2.30)" != '[]' ] && break; sleep 1; done
sleep 2
check "node-d got a host only for VMESS_TCP" [ "$(hosts_for 192.0.2.30)" = '["VMESS_TCP"]' ]
code=$(api DELETE "/node/$NODE_D")
check "delete node-d" [ "$code" = 200 ]

wait_connected node-a node-b node-c node-e
expect_ports "node-a runs only VMESS_TCP (+ non-user inbound)" "$IP_A" "20001 20006" "20002 20003 20004"
expect_ports "node-b runs only VLESS_TCP + TROJAN_TCP" "$IP_B" "20002 20003 20006" "20001 20004"
expect_ports "node-c (no selection) runs every inbound" "$IP_C" "$ALL_PORTS" ""
expect_ports "rpyc node-e runs only TROJAN_TCP" "$IP_E" "20003 20006" "20001 20002 20004"
expect_ports "main core still runs every inbound" 127.0.0.1 "$ALL_PORTS" ""
check "panel log says which inbounds node-b gets" \
  bash -c "docker logs panel 2>&1 | grep -qF 'Node \"node-b\" gets only these inbounds: VLESS_TCP, TROJAN_TCP'"

before=$(log_count 'Connected to "node-e" node')
code=$(api PUT "/node/$NODE_E" '{"allowed_inbounds":["VLESS_TCP"]}')
check "edit rpyc node-e to [VLESS_TCP]" [ "$code" = 200 ]
check "editing reconnects node-e" wait_log_more 'Connected to "node-e" node' "$before"
expect_ports "rpyc node-e now runs only VLESS_TCP" "$IP_E" "20002 20006" "20001 20003 20004"

before=$(log_count 'Connected to "node-a" node')
code=$(api PUT "/node/$NODE_A" '{"allowed_inbounds":["SS_TCP"]}')
check "edit node-a to [SS_TCP]" [ "$code" = 200 ]
check "edit returns the new selection" [ "$(body .allowed_inbounds)" = '["SS_TCP"]' ]
check "editing the selection reconnects node-a" wait_log_more 'Connected to "node-a" node' "$before"
expect_ports "node-a now runs only SS_TCP" "$IP_A" "20004 20006" "20001 20002 20003"

before=$(log_count 'Xray core of "node-b" node restarted')
code=$(api POST /core/restart)
check "restart core" [ "$code" = 200 ]
check "core restart restarts node-b" wait_log_more 'Xray core of "node-b" node restarted' "$before"
expect_ports "after core restart node-b still runs only its inbounds" "$IP_B" "20002 20003 20006" "20001 20004"
expect_ports "after core restart node-a still runs only SS_TCP" "$IP_A" "20004 20006" "20001 20002 20003"
expect_ports "after core restart main core runs every inbound" 127.0.0.1 "$ALL_PORTS" ""

before=$(log_count 'Connected to "node-b" node')
code=$(api POST "/node/$NODE_B/reconnect")
check "reconnect node-b" [ "$code" = 200 ]
check "reconnect reached node-b" wait_log_more 'Connected to "node-b" node' "$before"
expect_ports "after reconnect node-b still runs only its inbounds" "$IP_B" "20002 20003 20006" "20001 20004"

code=$(api POST /user "$(printf "$USER_JSON" bob)")
check "create user bob while nodes are restricted" [ "$code" = 200 ]
code=$(api PUT /user/bob '{"status":"disabled"}')
check "disable bob" [ "$code" = 200 ]
code=$(api DELETE /user/bob)
check "delete bob" [ "$code" = 200 ]
sleep 5
check "no 'handler not found' errors when pushing users to restricted nodes" \
  bash -c "! docker logs panel 2>&1 | grep -E 'TagNotFoundError|handler not found'"

before=$(log_count 'Connected to "node-a" node')
code=$(api PUT "/node/$NODE_A" '{"allowed_inbounds":[]}')
check "clear node-a selection with []" [ "$code" = 200 ]
check "cleared selection is returned as null" [ "$(body .allowed_inbounds)" = null ]
check "clearing reconnects node-a" wait_log_more 'Connected to "node-a" node' "$before"
expect_ports "node-a runs every inbound again" "$IP_A" "$ALL_PORTS" ""

echo "== [$DB] 4. roll back to $OLD_IMAGE"
docker logs panel >"$WORK/panel-new.log" 2>&1
docker stop panel >/dev/null
run_panel "$IMAGE" alembic downgrade 2b231de97dc3 >"$WORK/downgrade.log" 2>&1
cat "$WORK/downgrade.log"
check "migration 4c2b9a7e1f36 -> 2b231de97dc3 rolled back" grep -q "4c2b9a7e1f36 -> 2b231de97dc3" "$WORK/downgrade.log"
run_panel "$IMAGE" python /e2e/dump_db.py /out/rolled-back.json
check "column removed, all 5 nodes kept" python3 -c '
import json, sys
nodes = json.load(open(sys.argv[1]))["nodes"]
sys.exit(not (len(nodes) == 5 and not any("allowed_inbounds" in row for row in nodes)))
' "$WORK/rolled-back.json"
start_panel "$OLD_IMAGE"
check "upstream image migrates the rolled-back database without errors" \
  bash -c "! docker logs panel 2>&1 | grep -iE \"can't locate revision|CommandError\""
api GET /nodes >/dev/null
check "upstream image lists all 5 nodes" [ "$(body 'length')" = 5 ]
api GET /users >/dev/null
check "upstream image still has alice" [ "$(body '[.users[].username]')" = '["alice"]' ]

echo "== [$DB] $PASS passed, $FAIL failed"
if ((FAIL > 0)); then
  echo "--- new panel log"; tail -150 "$WORK/panel-new.log" 2>/dev/null
  echo "--- current panel log"; docker logs panel 2>&1 | tail -60
  for n in a b c e; do echo "--- node-$n log"; docker logs "node-$n" 2>&1 | tail -30; done
  exit 1
fi
