"""Dump every table of the Marzban database to JSON (run inside the image with PYTHONPATH=/code)."""
import json
import sys

import sqlalchemy as sa

from config import SQLALCHEMY_DATABASE_URL

engine = sa.create_engine(SQLALCHEMY_DATABASE_URL)
meta = sa.MetaData()
meta.reflect(engine)

dump = {}
with engine.connect() as conn:
    for name, table in meta.tables.items():
        rows = conn.execute(sa.select(table)).mappings().all()
        dump[name] = sorted(json.dumps(dict(row), default=str, sort_keys=True) for row in rows)

with open(sys.argv[1], "w") as f:
    json.dump(dump, f, indent=1, sort_keys=True)
