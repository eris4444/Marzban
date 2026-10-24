# Per-node inbound selection

This branch (`feature/node-allowed-inbounds`, based on Marzban v0.8.4) lets you choose, per node,
which inbounds are built on it. In **Nodes → add / edit node** every inbound is ticked by default
(the node runs all of them, exactly like upstream Marzban); untick the inbounds that must not exist
on that node and save. At least one box has to stay ticked.

- Only the chosen user inbounds are sent to that node. Inbounds Marzban doesn't manage
  (`API_INBOUND`, tags in `XRAY_EXCLUDE_INBOUND_TAGS`, non-proxy protocols such as dokodemo-door)
  are always kept.
- An inbound ticked on a node that doesn't run everything is **not built on the main server**: it
  works only through the nodes, and only while such a node is up. It counts even while that node is
  disabled; deleting the node or ticking every box on it gives the inbound back to the main server.
  The main core restarts by itself when this set changes. Nodes with every box ticked still run
  every inbound and take nothing away from the main server. `xray_config.json` is never edited.
- The selection is applied on node connect, reconnect, edit and "restart core".
- "Add this node as a new host" on a new node creates hosts only for the inbounds it runs
  (for every inbound when nothing is selected).
- API: `allowed_inbounds` (list of inbound tags, or `null`) on `POST /api/node`, `PUT /api/node/{id}`
  and in every node response. On `PUT`, omit it (or send `null`) to keep the current selection and
  send `[]` to clear it. Unknown tags are rejected with 422.

## Database

One Alembic migration (`4c2b9a7e1f36`) adds a single nullable column, `nodes.allowed_inbounds`.
No existing row is rewritten; every existing node gets `NULL`, which means "all inbounds".
CI proves this on SQLite, MySQL 8 and MariaDB: it dumps every table of a database made by upstream
v0.8.4, upgrades it, and checks that every old row still holds exactly the same values.

## Install (official `/opt/marzban` setup)

1. Back up first, e.g. for SQLite: `cp /var/lib/marzban/db.sqlite3 /var/lib/marzban/db.sqlite3.bak`
2. In `/opt/marzban/docker-compose.yml` set `image: ghcr.io/eris4444/marzban:node-inbounds`
3. `cd /opt/marzban && docker compose pull && docker compose up -d`
   (the container runs `alembic upgrade head` on start).

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

1. While this image is still running: `docker compose exec marzban alembic downgrade 2b231de97dc3`
2. Set the image back to `gozargah/marzban:latest` and run `docker compose up -d`.

## Checking what a node runs

- `bash node-inbounds-check.sh` on the main server (it changes nothing) prints, for every inbound,
  where it should run and whether its port really listens on the main server and on each node,
  then where every subscription host points, and ends with a `PROBLEM:` line for each mismatch.
- Panel log, after saving a node: `docker compose logs marzban | grep "gets only these inbounds"`
  prints e.g. `Node "DE" gets only these inbounds: VLESS TCP REALITY`.
- On the node server: `ss -ltnp | grep xray` lists the ports its Xray really listens on.
- Panel log: `Main core leaves out inbounds picked for nodes: ...` lists what the main server dropped.
- Subscriptions still list the main server's host (default `{SERVER_IP}`) for those inbounds; that
  link no longer connects. Disable those hosts in Host Settings if you don't want them shown.

## Things to keep in mind

- A user whose inbounds are all missing on a node can't connect through that node. Subscriptions
  are unchanged and existing hosts are never edited, so a host that points at a node's address for
  an inbound the node doesn't run (an older host, or one left after you changed the selection)
  gives a link that fails. Remove or disable such hosts in Host Settings.
- An inbound without its own port (served through `XRAY_FALLBACKS_INBOUND_TAG`) can only be chosen
  together with that fallbacks inbound.
- If you later delete an inbound from `xray_config.json`, nodes that listed only that tag run no
  user inbounds; the panel logs a warning and the dashboard shows the stale tag struck through.
- When upstream adds new migrations, rebase this branch and point `down_revision` of
  `4c2b9a7e1f36` at the new upstream head.

## Tests

`.github/workflows/node-allowed-inbounds.yml` builds the dashboard and the image, runs
`tests/test_node_allowed_inbounds.py` inside it, then `tests/e2e/run.sh` against real
`marzban-node` containers for SQLite, MySQL and MariaDB and pushes the image to GHCR.
