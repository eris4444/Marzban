import os
from pathlib import Path

# must be set before anything imports config.py / app
os.environ.setdefault("XRAY_JSON", str(Path(__file__).parent / "xray_config.test.json"))
os.environ.setdefault("XRAY_FALLBACKS_INBOUND_TAG", "FALLBACK_MAIN")
os.environ.setdefault("SQLALCHEMY_DATABASE_URL", "sqlite:////tmp/marzban-test.sqlite3")
