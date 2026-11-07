"""Configuration settings for Cloud Backend."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional


# Project Root Directory
BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Database URL: uses PostgreSQL if provided, defaults to SQLite for local development
DEFAULT_SQLITE_URL = f"sqlite:///{BASE_DIR / 'marine_cloud.db'}"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_SQLITE_URL)

# Gateway Ingestion Authentication API Key
API_KEY = os.getenv("API_KEY", "marine_secret_key_2026")

# Telegram Bot Notifications (Optional)
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# Machine Learning Model Artifact Path
# Supports local path and container volume path (/app/models/marine_model.joblib)
DEFAULT_LOCAL_MODEL = BASE_DIR / "ml" / "models" / "marine_model.joblib"
CONTAINER_MODEL = Path("/app/models/marine_model.joblib")

if CONTAINER_MODEL.exists():
    MODEL_PATH = str(CONTAINER_MODEL)
elif DEFAULT_LOCAL_MODEL.exists():
    MODEL_PATH = str(DEFAULT_LOCAL_MODEL)
else:
    MODEL_PATH = os.getenv("MODEL_PATH", str(DEFAULT_LOCAL_MODEL))

