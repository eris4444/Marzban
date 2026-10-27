# Nodes only, with per-node inbounds

This branch (`feature/node-allowed-inbounds`, based on Marzban v0.8.4) makes Marzban work like
PasarGuard: **the panel only manages, nodes serve.**

- **The panel's own Xray core runs no inbounds** (`MAIN_CORE_INBOUNDS=none`, the default). A config
  works only through a connected node that runs its inbound. Disable or lose every node and no
  config works anywhere.
- **Each node runs only the inbounds ticked for it** in Nodes → add / edit node. Every box is
  ticked by default (the node runs all inbounds, like upstream); untick what must not exist there.
  At least one box has to stay ticked.
- **To serve configs on the panel server too**, run a node on it: `local-node.sh` (below). The
  default `{SERVER_IP}` hosts point at the panel server, so they work exactly for the inbounds
  ticked on that local node.

## Compared with PasarGuard

PasarGuard's panel has no Xray process at all; every node is started with a core config from the
database and only the users of that config's inbounds. Here the panel keeps one `xray_config.json`
and starts each node with the ticked part of it, with the users of those inbounds only; the
panel's own core keeps running with just its API inbound (Marzban's usage and health jobs talk to
it), so nothing on the panel server listens for clients unless a node runs there.

## What each node gets

- Only the ticked user inbounds, and the users in them. Inbounds Marzban doesn't manage
  (`API_INBOUND`, tags in `XRAY_EXCLUDE_INBOUND_TAGS`, non-proxy protocols such as dokodemo-door)
  go to every node.
- The selection is applied on connect, reconnect, edit and "restart core"; adding, editing or
  removing a user reaches only the nodes that run that inbound.
- "Add this node as a new host" on a new node creates hosts only for the inbounds it runs.
- API: `allowed_inbounds` (list of inbound tags, or `null` for all) on `POST /api/node`,
  `PUT /api/node/{id}` and every node response. On `PUT`, omit it (or send `null`) to keep the
  current selection and send `[]` to select all. Unknown tags are rejected with 422.
  `GET /api/node/settings` also returns `main_core_inbounds`.

## A node on the panel server: `local-node.sh`

Run on the panel server, as root:

```bash
bash local-node.sh                                         # node "local", every inbound
INBOUNDS="VLESS TCP REALITY,VMESS WS" bash local-node.sh   # only these inbounds
```

It

1. checks that the panel runs this image with `MAIN_CORE_INBOUNDS=none` and `network_mode: host`,
2. writes `/opt/marzban-node/docker-compose.yml` and the panel's client certificate to
   `/var/lib/marzban-node/ssl_client_cert.pem`, and starts `gozargah/marzban-node` with its service
   (62050) and Xray API (62051) on **127.0.0.1 only**, so nothing new is reachable from outside;
   if Docker Hub can't be reached it uses the same image from `ghcr.io/eris4444/marzban:marzban-node`,
3. adds it to the panel as node `local` with address `127.0.0.1` and no extra hosts, through the
   panel API with a 10-minute sudo token it signs with the panel's own key (no password needed),
4. waits until the panel shows the node connected.

Running it again changes nothing that's already there: an existing host-network marzban-node on
this server (e.g. one installed with the official script in `/opt/marzban-node`) is reused, its
certificate is replaced with this panel's if it differs (the old one is kept as `.bak`), and a node
that is already in the panel isn't added twice (with `INBOUNDS=...` its selection is updated).
Settings: `NODE_NAME`, `INBOUNDS`, `NODE_DIR`, `NODE_DATA`, `SERVICE_PORT`, `XRAY_API_PORT`,
`NODE_IMAGE`, `MARZBAN_DIR`, `MARZBAN_CONTAINER`.

## The old behaviour: `MAIN_CORE_INBOUNDS=auto`

Put `MAIN_CORE_INBOUNDS=auto` in `/opt/marzban/.env` and run `docker compose up -d`: the panel's
core then runs every inbound that no node has ticked in a limited selection (nodes with every box
ticked take nothing away). Don't combine it with a node on the panel server: both would want the
same ports, so `local-node.sh` refuses to run in this mode.

## Database

One Alembic migration (`4c2b9a7e1f36`) adds a single nullable column, `nodes.allowed_inbounds`.
No existing row is rewritten; every existing node gets `NULL`, which means "all inbounds".
`MAIN_CORE_INBOUNDS` is an environment setting, not stored in the database.
CI proves this on SQLite, MySQL 8 and MariaDB: it dumps every table of a database made by upstream
v0.8.4, upgrades it, and checks that every old row still holds exactly the same values.

## Install (official `/opt/marzban` setup)

1. Back up, e.g. for SQLite: `cp /var/lib/marzban/db.sqlite3 /var/lib/marzban/db.sqlite3.bak`
2. In `/opt/marzban/docker-compose.yml` set `image: ghcr.io/eris4444/marzban:node-inbounds`
   (or a fixed `node-inbounds-<commit>` tag) and run `cd /opt/marzban && docker compose pull && docker compose up -d`.
   From here on, configs pointing at the panel server stop working.
3. `bash local-node.sh` on the panel server, if configs should work there; they work again as soon
   as it says the node is connected (about a minute after step 2).

The image is the official `gozargah/marzban:v0.8.4` image with this branch's code copied on top
(`Dockerfile.node-inbounds`), so Python packages and the Xray binary are exactly the ones you run
today. To build it yourself instead:

```bash
git clone -b feature/node-allowed-inbounds https://github.com/eris4444/Marzban /opt/marzban-src
cd /opt/marzban-src && docker build -f Dockerfile.node-inbounds -t marzban:node-inbounds .
```

and use `image: marzban:node-inbounds`. (Upstream's own `Dockerfile` no longer builds today: current
setuptools dropped `pkg_resources`, which APScheduler 3.9.1 imports.)

## Going back to upstream

1. Delete the `local` node in the panel and stop it: `cd /opt/marzban-node && docker compose down`.
2. While this image is still running: `docker compose exec marzban alembic downgrade 2b231de97dc3`
3. Set the image back to `gozargah/marzban:latest` and run `docker compose up -d`.

## Checking where each inbound runs

- `bash node-inbounds-check.sh` on the panel server (it changes nothing) prints, for every inbound,
  where it should run and whether its port really listens on the panel's own core and on each node
  (a node on the panel server included), then where every subscription host points, and ends with
  a `PROBLEM:` line for each mismatch.
- Panel log: `Main core runs no inbounds (MAIN_CORE_INBOUNDS=none)` after each core start, and
  `Node "DE" gets only these inbounds: ...` after a node is saved.
- On a node server: `ss -ltnp | grep xray` lists the ports its Xray really listens on.

## Things to keep in mind

- Subscriptions and hosts are unchanged: a host whose address leads to a server that doesn't run
  its inbound (the panel server without a local node, or a node whose selection changed) still
  appears and its link fails. Disable or remove such hosts in Host Settings; the check script lists
  them.
- A user whose inbounds are all missing on a node can't connect through that node.
- An inbound without its own port (served through `XRAY_FALLBACKS_INBOUND_TAG`) can only be chosen
  together with that fallbacks inbound.
- If you later delete an inbound from `xray_config.json`, nodes that listed only that tag run no
  user inbounds; the panel logs a warning and the dashboard shows the stale tag struck through.
- When upstream adds new migrations, rebase this branch and point `down_revision` of
  `4c2b9a7e1f36` at the new upstream head.

## Tests

`.github/workflows/node-allowed-inbounds.yml` builds the dashboard and the image, runs
`tests/test_node_allowed_inbounds.py` inside it, then `tests/e2e/run.sh` for SQLite, MySQL and
MariaDB: real `marzban-node` containers (REST and rpyc) with different selections, the panel's own
core with no inbounds, a node on the panel server made by `local-node.sh` (enabled, disabled,
removed), `MAIN_CORE_INBOUNDS=auto`, the check script, and a rollback to upstream. Then it pushes the
image to GHCR.
