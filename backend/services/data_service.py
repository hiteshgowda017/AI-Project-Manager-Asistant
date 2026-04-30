import json
import os
import tempfile
import threading
import time
from typing import Any, Dict, List

from config import Config
from utils.errors import NotFoundError


class DataService:
    _path = ""
    _lock = threading.Lock()
    _repaired = False

    _DEFAULT_COLLECTIONS = (
        "workspaces",
        "projects",
        "tasks",
        "insights",
        "task_drafts",
        "decisions",
        "reports",
        "project_health",
        "jobs",
    )

    @classmethod
    def _default_data(cls) -> Dict[str, Any]:
        return {name: [] for name in cls._DEFAULT_COLLECTIONS}

    @classmethod
    def initialize(cls, path: str) -> None:
        cls._path = path
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        with cls._lock:
            if not os.path.exists(path):
                cls._write_locked(cls._default_data())
                return

            # Ensure required collections exist (backward-compatible)
            data = cls._read_locked()
            changed = False
            for name in cls._DEFAULT_COLLECTIONS:
                if name not in data or not isinstance(data.get(name), list):
                    data[name] = []
                    changed = True

            # Phase 2: repair relationship integrity (reload-safe)
            repaired = False
            if not cls._repaired:
                repaired = cls._repair_relationship_integrity_locked(data)
                cls._repaired = True

            if changed or repaired:
                cls._write_locked(data)

    @classmethod
    def _repair_relationship_integrity_locked(cls, data: Dict[str, Any]) -> bool:
        """Repair old/broken records already persisted in data.json.

        Goals:
        - Remove orphan projects (missing/invalid workspace)
        - Remove orphan tasks/reports/etc. (missing/invalid project)
        - Deduplicate by stable key per collection
        - Align report metadata with canonical project/workspace
        """

        changed = False

        def ensure_list_of_dicts(value: Any) -> List[Dict[str, Any]]:
            if not isinstance(value, list):
                return []
            return [item for item in value if isinstance(item, dict)]

        def stable_key(collection: str, item: Dict[str, Any]) -> Any:
            if collection == "project_health":
                return item.get("projectId")
            return item.get("id")

        def dedupe(collection: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
            seen = set()
            result: List[Dict[str, Any]] = []
            for item in items:
                key = stable_key(collection, item)
                if not key:
                    continue
                if key in seen:
                    continue
                seen.add(key)
                result.append(item)
            return result

        # Coerce and dedupe collections first to avoid explosive corruption.
        for collection in cls._DEFAULT_COLLECTIONS:
            original = data.get(collection)
            coerced = ensure_list_of_dicts(original)
            if coerced != original:
                data[collection] = coerced
                changed = True
            deduped = dedupe(collection, data.get(collection, []))
            if len(deduped) != len(data.get(collection, [])):
                data[collection] = deduped
                changed = True

        workspace_ids = {w.get("id") for w in data.get("workspaces", []) if w.get("id")}

        # Remove orphan projects (workspaceId must exist).
        projects = data.get("projects", [])
        kept_projects = [p for p in projects if p.get("id") and p.get("workspaceId") in workspace_ids]
        if len(kept_projects) != len(projects):
            data["projects"] = kept_projects
            changed = True

        project_ids = {p.get("id") for p in data.get("projects", []) if p.get("id")}
        projects_by_id = {p.get("id"): p for p in data.get("projects", []) if p.get("id")}

        # Remove orphan records that link to projects.
        collections_by_project_id = [
            "tasks",
            "reports",
            "insights",
            "task_drafts",
            "decisions",
            "project_health",
        ]
        for collection in collections_by_project_id:
            items = data.get(collection, [])
            kept = [i for i in items if i.get("projectId") in project_ids]
            if len(kept) != len(items):
                data[collection] = kept
                changed = True

        # Repair report metadata against canonical project/workspace.
        workspaces_by_id = {w.get("id"): w for w in data.get("workspaces", []) if w.get("id")}
        reports = data.get("reports", [])
        for report in reports:
            project_id = report.get("projectId")
            project = projects_by_id.get(project_id)
            if not project:
                continue
            workspace_id = project.get("workspaceId")
            workspace = workspaces_by_id.get(workspace_id)
            if report.get("workspaceId") != workspace_id:
                report["workspaceId"] = workspace_id
                changed = True
            project_name = project.get("name")
            if project_name and report.get("projectName") != project_name:
                report["projectName"] = project_name
                changed = True
            workspace_name = workspace.get("name") if workspace else None
            if workspace_name and report.get("workspaceName") != workspace_name:
                report["workspaceName"] = workspace_name
                changed = True

        return changed

    @classmethod
    def _read(cls) -> Dict[str, Any]:
        with cls._lock:
            return cls._read_locked()

    @classmethod
    def _read_locked(cls) -> Dict[str, Any]:
        if not cls._path:
            return cls._default_data()

        if not os.path.exists(cls._path):
            data = cls._default_data()
            cls._write_locked(data)
            return data

        try:
            with open(cls._path, "r", encoding="utf-8") as file:
                data = json.load(file)
        except (json.JSONDecodeError, ValueError):
            # If the JSON is corrupted (partial write / manual edit), keep a copy and recover.
            try:
                stamp = time.strftime("%Y%m%d-%H%M%S")
                backup_path = f"{cls._path}.corrupt.{stamp}"
                os.replace(cls._path, backup_path)
            except OSError:
                pass
            data = cls._default_data()
            cls._write_locked(data)

        if not isinstance(data, dict):
            data = cls._default_data()
            cls._write_locked(data)

        # Normalize required collections
        for name in cls._DEFAULT_COLLECTIONS:
            if name not in data or not isinstance(data.get(name), list):
                data[name] = []

        return data

    @classmethod
    def _write(cls, data: Dict[str, Any]) -> None:
        with cls._lock:
            cls._write_locked(data)

    @classmethod
    def _write_locked(cls, data: Dict[str, Any]) -> None:
        directory = os.path.dirname(cls._path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        fd, tmp_path = tempfile.mkstemp(
            prefix=os.path.basename(cls._path) + ".",
            suffix=".tmp",
            dir=directory or None,
            text=True,
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(data, file, indent=2)
                file.flush()
                os.fsync(file.fileno())
            os.replace(tmp_path, cls._path)
        finally:
            try:
                if os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                pass

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
