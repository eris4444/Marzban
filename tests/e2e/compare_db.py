"""Check that an upgraded database still holds exactly the old data.

Usage: compare_db.py before.json after.json
The only allowed difference is the new nodes.allowed_inbounds column, which must be NULL everywhere.
"""
import json
import sys

before, after = (json.load(open(path)) for path in sys.argv[1:3])
ok = True

for table in sorted(set(before) | set(after)):
    if table == "alembic_version":
        continue
    old, new = before.get(table), after.get(table)

    if table == "nodes" and new is not None:
        rows = [json.loads(row) for row in new]
        if any(row.pop("allowed_inbounds", "missing") is not None for row in rows):
            print("nodes.allowed_inbounds is missing or not NULL")
            ok = False
        new = sorted(json.dumps(row, sort_keys=True) for row in rows)

    if old != new:
        print(f"table {table} changed:\n  before={old}\n  after={new}")
        ok = False
    else:
        print(f"table {table}: {len(old or [])} rows unchanged")

sys.exit(0 if ok else 1)
