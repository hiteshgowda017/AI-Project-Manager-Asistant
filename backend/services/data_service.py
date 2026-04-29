import json
import os
import threading
from typing import Any, Dict, List

from config import Config
from utils.errors import NotFoundError


class DataService:
    _path = ""
    _lock = threading.Lock()

    @classmethod
    def initialize(cls, path: str) -> None:
        cls._path = path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if not os.path.exists(path):
            initial = {
                "workspaces": [],
                "projects": [],
                "tasks": [],
                "insights": [],
                "task_drafts": [],
                "decisions": [],
                "reports": [],
                "project_health": [],
                "jobs": [],
            }
            cls._write(initial)

    @classmethod
    def _read(cls) -> Dict[str, Any]:
        with cls._lock:
            with open(cls._path, "r", encoding="utf-8") as file:
                return json.load(file)

    @classmethod
    def _write(cls, data: Dict[str, Any]) -> None:
        with cls._lock:
            with open(cls._path, "w", encoding="utf-8") as file:
                json.dump(data, file, indent=2)

    @classmethod
    def list_collection(cls, name: str) -> List[Dict[str, Any]]:
        data = cls._read()
        return list(data.get(name, []))

    @classmethod
    def save_collection(cls, name: str, items: List[Dict[str, Any]]) -> None:
        data = cls._read()
        data[name] = items
        cls._write(data)

    @classmethod
    def add_item(cls, name: str, item: Dict[str, Any]) -> Dict[str, Any]:
        items = cls.list_collection(name)
        items.append(item)
        cls.save_collection(name, items)
        return item

    @classmethod
    def update_item(cls, name: str, item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        items = cls.list_collection(name)
        updated = None
        for index, item in enumerate(items):
            if item.get("id") == item_id:
                items[index] = {**item, **updates}
                updated = items[index]
                break
        if updated is None:
            raise NotFoundError("Item not found")
        cls.save_collection(name, items)
        return updated

    @classmethod
    def delete_item(cls, name: str, item_id: str) -> None:
        items = cls.list_collection(name)
        filtered = [item for item in items if item.get("id") != item_id]
        if len(filtered) == len(items):
            raise NotFoundError("Item not found")
        cls.save_collection(name, filtered)

    @classmethod
    def get_item(cls, name: str, item_id: str) -> Dict[str, Any]:
        items = cls.list_collection(name)
        for item in items:
            if item.get("id") == item_id:
                return item
        raise NotFoundError("Item not found")

    @staticmethod
    def paginate(items: List[Dict[str, Any]], page: int, page_size: int):
        total_items = len(items)
        total_pages = max(1, (total_items + page_size - 1) // page_size)
        page = max(1, min(page, total_pages))
        start = (page - 1) * page_size
        end = start + page_size
        return {
            "items": items[start:end],
            "page": page,
            "pageSize": page_size,
            "totalItems": total_items,
            "totalPages": total_pages,
        }

    @staticmethod
    def new_id() -> str:
        return Config.new_id()

    @staticmethod
    def now_iso() -> str:
        return Config.utcnow_iso()
