import os
import uuid
from datetime import datetime, timezone


class Config:
    def __init__(self) -> None:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        data_default = os.path.join(base_dir, "data", "data.json")

        self.APP_ENV = os.getenv("APP_ENV", "development")
        self.APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
        self.APP_PORT = os.getenv("APP_PORT", "8000")
        self.APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
        self.DATA_PATH = os.getenv("DATA_PATH", data_default)
        self.LOG_LEVEL = os.getenv("LOG_LEVEL", "info")
        self.API_RATE_LIMIT = os.getenv("API_RATE_LIMIT", "")
        self.CORS_ALLOWED_ORIGINS = self._parse_origins(
            os.getenv("CORS_ALLOWED_ORIGINS", "")
        )

    @staticmethod
    def _parse_origins(raw: str):
        raw = raw.strip()
        if not raw:
            return []
        return [item.strip() for item in raw.split(",") if item.strip()]

    @staticmethod
    def utcnow_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    @staticmethod
    def new_id() -> str:
        return str(uuid.uuid4())
