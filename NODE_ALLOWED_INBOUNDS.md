# Per-node inbound selection

This branch (`feature/node-allowed-inbounds`, based on Marzban v0.8.4) lets you choose, per node,
which inbounds run on it. In **Nodes → add / edit node** tick the inbounds for that node; leave every
box empty and the node runs all inbounds, exactly like upstream Marzban.

- Only the chosen user inbounds are sent to that node. Inbounds Marzban doesn't manage
  (`API_INBOUND`, tags in `XRAY_EXCLUDE_INBOUND_TAGS`, non-proxy protocols such as dokodemo-door)
  are always kept.
- `xray_config.json` and the panel's own core are not touched: the main server keeps every inbound.
- The selection is applied on node connect, reconnect, edit and "restart core".
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

## Things to keep in mind

- A user whose inbounds are all missing on a node can't connect through that node. Hosts and
  subscriptions are unchanged, so links pointing at that node's address for an inbound it doesn't
  run will fail. Remove or disable those hosts (and don't tick "add as new host for every inbound"
  for restricted nodes, it still adds a host for every inbound).
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
