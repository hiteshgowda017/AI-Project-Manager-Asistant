import json
import os
import tempfile
import threading
import time
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from config import Config
from utils.errors import ConflictError, NotFoundError, ValidationError


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

    _CANONICAL_COLLECTIONS = (
        "workspaces",
        "projects",
        "tasks",
        "reports",
        "project_health",
        "jobs",
    )

    _COLLECTIONS_WITH_PROJECT_FK = (
        "tasks",
        "reports",
        "insights",
        "task_drafts",
        "decisions",
        "project_health",
    )

    _PROJECT_STATUSES = {"planned", "active", "blocked", "on_hold", "completed", "archived"}
    _HEALTH_STATUSES = {"green", "amber", "red"}
    _PROJECT_PRIORITIES = {"low", "medium", "high"}
    _TASK_STATUSES = {"planned", "in_progress", "review", "blocked", "completed"}
    _TASK_PRIORITIES = {"low", "medium", "high", "critical"}
    _REPORT_STATUSES = {"queued", "processing", "ready", "failed"}
    _REPORT_TYPES = {"status", "risk", "timeline", "resource", "executive"}
    _REPORT_FORMATS = {"json", "csv", "pdf"}
    _REPORT_KINDS = {"completion"}
    _JOB_STATUSES = {"processing", "completed", "failed"}
    _JOB_RESULT_TYPES = {"insights"}

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
        - Canonicalize + repair legacy field mismatches and timestamps
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
        for collection in cls._COLLECTIONS_WITH_PROJECT_FK:
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

        # Canonicalize records (best-effort) after integrity cleanup.
        canon_changed, canon_data = cls._canonicalize_data_best_effort(data)
        if canon_changed:
            data.clear()
            data.update(canon_data)
            changed = True

        return changed

    @classmethod
    def _canonicalize_data_best_effort(cls, data: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """Best-effort canonicalization used for legacy repair and safe reads.

        - Never raises for invalid legacy values.
        - Drops irreparable records (missing IDs/parents).
        - Normalizes enum aliases, timestamps, and known field mismatches.
        """

        now = cls.now_iso()
        changed = False
        result: Dict[str, Any] = {name: list(data.get(name, [])) for name in cls._DEFAULT_COLLECTIONS}

        # Normalize + sanitize each collection.
        workspaces_norm: List[Dict[str, Any]] = []
        for w in result.get("workspaces", []):
            normalized = cls._normalize_workspace_best_effort(w, now)
            if normalized is None:
                changed = True
                continue
            if normalized != w:
                changed = True
            workspaces_norm.append(normalized)
        result["workspaces"] = cls._dedupe_by_key("workspaces", workspaces_norm)

        workspace_ids = {w.get("id") for w in result["workspaces"] if w.get("id")}

        projects_norm: List[Dict[str, Any]] = []
        for p in result.get("projects", []):
            normalized = cls._normalize_project_best_effort(p, now)
            if normalized is None:
                changed = True
                continue
            if normalized.get("workspaceId") not in workspace_ids:
                changed = True
                continue
            if normalized != p:
                changed = True
            projects_norm.append(normalized)
        result["projects"] = cls._dedupe_by_key("projects", projects_norm)

        project_ids = {p.get("id") for p in result["projects"] if p.get("id")}
        projects_by_id = {p.get("id"): p for p in result["projects"] if p.get("id")}
        workspaces_by_id = {w.get("id"): w for w in result["workspaces"] if w.get("id")}

        tasks_norm: List[Dict[str, Any]] = []
        for t in result.get("tasks", []):
            normalized = cls._normalize_task_best_effort(t, now)
            if normalized is None:
                changed = True
                continue
            if normalized.get("projectId") not in project_ids:
                changed = True
                continue
            if normalized != t:
                changed = True
            tasks_norm.append(normalized)
        result["tasks"] = cls._dedupe_by_key("tasks", tasks_norm)

        reports_norm: List[Dict[str, Any]] = []
        for r in result.get("reports", []):
            normalized = cls._normalize_report_best_effort(r, now)
            if normalized is None:
                changed = True
                continue
            project_id = normalized.get("projectId")
            if project_id not in project_ids:
                changed = True
                continue
            # Repair parent-derived metadata.
            project = projects_by_id.get(project_id) or {}
            workspace_id = project.get("workspaceId")
            workspace = workspaces_by_id.get(workspace_id) or {}
            if workspace_id and normalized.get("workspaceId") != workspace_id:
                normalized["workspaceId"] = workspace_id
                changed = True
            if project.get("name") and normalized.get("projectName") != project.get("name"):
                normalized["projectName"] = project.get("name")
                changed = True
            if workspace.get("name") and normalized.get("workspaceName") != workspace.get("name"):
                normalized["workspaceName"] = workspace.get("name")
                changed = True

            if normalized != r:
                changed = True
            reports_norm.append(normalized)
        result["reports"] = cls._dedupe_by_key("reports", reports_norm)

        # project_health unique key is projectId.
        health_norm: List[Dict[str, Any]] = []
        for h in result.get("project_health", []):
            normalized = cls._normalize_project_health_best_effort(h, now)
            if normalized is None:
                changed = True
                continue
            if normalized.get("projectId") not in project_ids:
                changed = True
                continue
            if normalized != h:
                changed = True
            health_norm.append(normalized)
        result["project_health"] = cls._dedupe_by_key("project_health", health_norm)

        jobs_norm: List[Dict[str, Any]] = []
        for j in result.get("jobs", []):
            normalized = cls._normalize_job_best_effort(j, now)
            if normalized is None:
                changed = True
                continue
            # Validate resultRef.projectId if present
            result_ref = normalized.get("resultRef")
            if isinstance(result_ref, dict):
                ref_pid = result_ref.get("projectId")
                if ref_pid and ref_pid not in project_ids:
                    # orphan resultRef -> null it rather than dropping the job.
                    normalized["resultRef"] = None
                    changed = True
            if normalized != j:
                changed = True
            jobs_norm.append(normalized)
        result["jobs"] = cls._dedupe_by_key("jobs", jobs_norm)

        # For other collections not in the canonical contract, preserve contents but prevent orphans.
        for collection in ["insights", "task_drafts", "decisions"]:
            items = result.get(collection, [])
            kept = [i for i in items if isinstance(i, dict) and i.get("id") and i.get("projectId") in project_ids]
            if len(kept) != len(items):
                result[collection] = kept
                changed = True
            else:
                result[collection] = items

        # Ensure required collections exist.
        for name in cls._DEFAULT_COLLECTIONS:
            if name not in result or not isinstance(result.get(name), list):
                result[name] = []
                changed = True

        return changed, result

    @classmethod
    def _enforce_and_normalize_data_strict(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        """Strict canonicalization for writes.

        - Raises ValidationError/ConflictError for invalid records.
        - Normalizes known legacy aliases and timestamp fields.
        - Enforces FK integrity and collection-level uniqueness.
        """

        now = cls.now_iso()
        normalized: Dict[str, Any] = {name: list(data.get(name, [])) for name in cls._DEFAULT_COLLECTIONS}

        # Ensure every collection is a list of dicts
        for collection in cls._DEFAULT_COLLECTIONS:
            value = normalized.get(collection)
            if not isinstance(value, list):
                normalized[collection] = []
            else:
                normalized[collection] = [v for v in value if isinstance(v, dict)]

        # Normalize canonical collections.
        normalized["workspaces"] = cls._normalize_collection_strict("workspaces", normalized["workspaces"], now)
        workspace_ids = {w["id"] for w in normalized["workspaces"]}

        normalized["projects"] = cls._normalize_collection_strict("projects", normalized["projects"], now)
        for p in normalized["projects"]:
            if p.get("workspaceId") not in workspace_ids:
                raise ValidationError("Invalid workspaceId")
        project_ids = {p["id"] for p in normalized["projects"]}
        projects_by_id = {p["id"]: p for p in normalized["projects"]}

        normalized["tasks"] = cls._normalize_collection_strict("tasks", normalized["tasks"], now)
        for t in normalized["tasks"]:
            if t.get("projectId") not in project_ids:
                raise ValidationError("Invalid projectId")

        normalized["reports"] = cls._normalize_collection_strict("reports", normalized["reports"], now)
        workspaces_by_id = {w["id"]: w for w in normalized["workspaces"]}
        for r in normalized["reports"]:
            pid = r.get("projectId")
            if pid not in project_ids:
                raise ValidationError("Invalid projectId")
            project = projects_by_id.get(pid) or {}
            wid = project.get("workspaceId")
            if wid and r.get("workspaceId") != wid:
                # Repair parent-derived field rather than failing.
                r["workspaceId"] = wid
            if project.get("name") and r.get("projectName") != project.get("name"):
                r["projectName"] = project.get("name")
            workspace = workspaces_by_id.get(wid) if wid else None
            if workspace and workspace.get("name") and r.get("workspaceName") != workspace.get("name"):
                r["workspaceName"] = workspace.get("name")

        # project_health strict
        normalized["project_health"] = cls._normalize_collection_strict(
            "project_health", normalized["project_health"], now
        )
        for h in normalized["project_health"]:
            if h.get("projectId") not in project_ids:
                raise ValidationError("Invalid projectId")

        # jobs strict
        normalized["jobs"] = cls._normalize_collection_strict("jobs", normalized["jobs"], now)
        for j in normalized["jobs"]:
            result_ref = j.get("resultRef")
            if result_ref is None:
                continue
            if not isinstance(result_ref, dict):
                raise ValidationError("Invalid resultRef")
            if result_ref.get("type") not in cls._JOB_RESULT_TYPES:
                raise ValidationError("Invalid resultRef.type")
            ref_pid = result_ref.get("projectId")
            if ref_pid not in project_ids:
                raise ValidationError("Invalid resultRef.projectId")

        # Enforce orphan-free extra collections as well (backward compatible)
        for collection in cls._COLLECTIONS_WITH_PROJECT_FK:
            if collection in cls._CANONICAL_COLLECTIONS:
                continue
            items = normalized.get(collection, [])
            for item in items:
                if not item.get("id"):
                    raise ValidationError(f"Missing id in {collection}")
                if item.get("projectId") not in project_ids:
                    raise ValidationError(f"Invalid projectId in {collection}")

        # Uniqueness across collections.
        cls._enforce_uniqueness_strict(normalized)

        return normalized

    @classmethod
    def _enforce_uniqueness_strict(cls, data: Dict[str, Any]) -> None:
        for collection in cls._DEFAULT_COLLECTIONS:
            items = data.get(collection, [])
            if collection == "project_health":
                keys = [i.get("projectId") for i in items]
                label = "projectId"
            else:
                keys = [i.get("id") for i in items]
                label = "id"
            seen = set()
            for key in keys:
                if not key:
                    raise ValidationError(f"Missing {label} in {collection}")
                if key in seen:
                    raise ConflictError(f"Duplicate {label} in {collection}")
                seen.add(key)

    @classmethod
    def _normalize_collection_strict(cls, collection: str, items: List[Dict[str, Any]], now: str) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        for item in items:
            n = cls._normalize_record_strict(collection, item, now)
            normalized.append(n)
        return normalized

    @classmethod
    def _normalize_record_strict(cls, collection: str, item: Dict[str, Any], now: str) -> Dict[str, Any]:
        if collection == "workspaces":
            normalized = cls._normalize_workspace_best_effort(item, now)
        elif collection == "projects":
            normalized = cls._normalize_project_best_effort(item, now)
        elif collection == "tasks":
            normalized = cls._normalize_task_best_effort(item, now)
        elif collection == "reports":
            normalized = cls._normalize_report_best_effort(item, now)
        elif collection == "project_health":
            normalized = cls._normalize_project_health_best_effort(item, now)
        elif collection == "jobs":
            normalized = cls._normalize_job_best_effort(item, now)
        else:
            normalized = dict(item)

        if normalized is None:
            raise ValidationError(f"Invalid record in {collection}")
        return normalized

    @classmethod
    def _dedupe_by_key(cls, collection: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = set()
        result: List[Dict[str, Any]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            key = item.get("projectId") if collection == "project_health" else item.get("id")
            if not key:
                continue
            if key in seen:
                continue
            seen.add(key)
            result.append(item)
        return result

    @staticmethod
    def _as_non_empty_str(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _normalize_enum(value: Any, mapping: Dict[str, str], allowed: Iterable[str], default: Optional[str] = None) -> Optional[str]:
        if value is None:
            return default
        text = str(value).strip().lower().replace(" ", "_")
        text = mapping.get(text, text)
        if text in allowed:
            return text
        return default

    @staticmethod
    def _normalize_number(value: Any) -> Optional[float]:
        if value is None:
            return None
        try:
            number = float(value)
        except (TypeError, ValueError):
            return None
        return number

    @staticmethod
    def _normalize_int(value: Any) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    @classmethod
    def _normalize_datetime(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                # Accept ISO 8601 with Z.
                datetime.fromisoformat(text.replace("Z", "+00:00"))
                return text
            except ValueError:
                return None
        return None

    @classmethod
    def _normalize_date(cls, value: Any) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            value = str(value)
        text = value.strip()
        if not text:
            return None
        try:
            # Accept date-only or datetime; store as date string if date-only.
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed.date().isoformat()
        except ValueError:
            # Try date-only
            try:
                datetime.strptime(text, "%Y-%m-%d")
                return text
            except ValueError:
                return None

    @classmethod
    def _normalize_workspace_best_effort(cls, item: Dict[str, Any], now: str) -> Optional[Dict[str, Any]]:
        item_id = cls._as_non_empty_str(item.get("id"))
        if not item_id:
            return None
        name = cls._as_non_empty_str(item.get("name")) or "Untitled"
        created_at = cls._normalize_datetime(item.get("createdAt")) or now
        updated_at = cls._normalize_datetime(item.get("updatedAt")) or item.get("createdAt") or created_at
        return {
            **item,
            "id": item_id,
            "name": name,
            "description": item.get("description"),
            "domain": item.get("domain"),
            "createdAt": created_at,
            "updatedAt": updated_at,
        }

    @classmethod
    def _normalize_project_best_effort(cls, item: Dict[str, Any], now: str) -> Optional[Dict[str, Any]]:
        item_id = cls._as_non_empty_str(item.get("id"))
        if not item_id:
            return None
        workspace_id = cls._as_non_empty_str(item.get("workspaceId"))
        if not workspace_id:
            return None
        name = cls._as_non_empty_str(item.get("name")) or "Untitled"
        status = cls._normalize_enum(
            item.get("status"),
            mapping={"in_progress": "active", "inprogress": "active"},
            allowed=cls._PROJECT_STATUSES,
            default="planned",
        )
        health_status = cls._normalize_enum(
            item.get("healthStatus"),
            mapping={},
            allowed=cls._HEALTH_STATUSES,
            default="green",
        )
        priority = cls._normalize_enum(
            item.get("priority"),
            mapping={},
            allowed=cls._PROJECT_PRIORITIES,
            default=None,
        )
        progress = cls._normalize_int(item.get("progress"))
        if progress is None:
            progress = 0
        progress = max(0, min(100, progress))
        created_at = cls._normalize_datetime(item.get("createdAt")) or now
        updated_at = cls._normalize_datetime(item.get("updatedAt")) or item.get("createdAt") or created_at
        return {
            **item,
            "id": item_id,
            "workspaceId": workspace_id,
            "name": name,
            "description": item.get("description"),
            "startDate": cls._normalize_date(item.get("startDate")) if item.get("startDate") is not None else None,
            "endDate": cls._normalize_date(item.get("endDate")) if item.get("endDate") is not None else None,
            "owner": item.get("owner"),
            "status": status,
            "healthStatus": health_status,
            "priority": priority,
            "progress": progress,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }

    @classmethod
    def _normalize_task_best_effort(cls, item: Dict[str, Any], now: str) -> Optional[Dict[str, Any]]:
        item_id = cls._as_non_empty_str(item.get("id"))
        if not item_id:
            return None
        project_id = cls._as_non_empty_str(item.get("projectId"))
        if not project_id:
            return None
        title = cls._as_non_empty_str(item.get("title"))
        if not title:
            # Keep legacy tasks but ensure title is non-empty.
            title = "Untitled"
        status = cls._normalize_enum(
            item.get("status"),
            mapping={"todo": "planned", "backlog": "planned", "done": "completed"},
            allowed=cls._TASK_STATUSES,
            default="planned",
        )
        priority = cls._normalize_enum(item.get("priority"), mapping={}, allowed=cls._TASK_PRIORITIES, default=None)

        # Legacy alias normalization: assignedTo is canonical.
        assigned_to = cls._as_non_empty_str(item.get("assignedTo") or item.get("assignee"))
        due_date = cls._normalize_date(item.get("dueDate")) if item.get("dueDate") is not None else None

        estimate_hours = cls._normalize_number(item.get("estimateHours"))
        if estimate_hours is not None and estimate_hours < 0:
            estimate_hours = None
        actual_hours = cls._normalize_number(item.get("actualHours"))
        if actual_hours is not None and actual_hours < 0:
            actual_hours = None

        tags_value = item.get("tags")
        tags: List[str] = []
        if tags_value is None:
            tags = []
        elif isinstance(tags_value, list):
            for t in tags_value:
                text = cls._as_non_empty_str(t)
                if text:
                    tags.append(text)
        else:
            tags = []

        ai_suggestion = item.get("aiSuggestion")
        if ai_suggestion is not None and not isinstance(ai_suggestion, (str, dict, list)):
            ai_suggestion = None

        created_at = cls._normalize_datetime(item.get("createdAt")) or now
        updated_at = cls._normalize_datetime(item.get("updatedAt")) or item.get("createdAt") or created_at
        return {
            **item,
            "id": item_id,
            "projectId": project_id,
            "title": title,
            "description": item.get("description"),
            "status": status,
            "priority": priority,
            "assignedTo": assigned_to,
            "assignee": assigned_to,
            "dueDate": due_date,
            "aiSuggestion": ai_suggestion,
            "estimateHours": estimate_hours,
            "actualHours": actual_hours,
            "tags": tags,
            "createdAt": created_at,
            "updatedAt": updated_at,
        }

    @classmethod
    def _normalize_report_best_effort(cls, item: Dict[str, Any], now: str) -> Optional[Dict[str, Any]]:
        item_id = cls._as_non_empty_str(item.get("id"))
        if not item_id:
            return None
        project_id = cls._as_non_empty_str(item.get("projectId"))
        if not project_id:
            return None

        status = cls._normalize_enum(item.get("status"), mapping={}, allowed=cls._REPORT_STATUSES, default="ready")
        report_type = cls._as_non_empty_str(item.get("type"))
        if report_type is not None:
            # Enforce only known types; unknown legacy types become None.
            report_type = report_type.strip().lower()
            if report_type not in cls._REPORT_TYPES:
                report_type = None

        report_format = cls._as_non_empty_str(item.get("format"))
        if report_format is not None:
            report_format = report_format.strip().lower()
            if report_format not in cls._REPORT_FORMATS:
                report_format = None

        kind = cls._as_non_empty_str(item.get("kind"))
        if kind is not None:
            kind = kind.strip().lower()
            if kind not in cls._REPORT_KINDS:
                kind = None

        report_range = item.get("range")
        if report_range is not None and not isinstance(report_range, dict):
            report_range = None
        if isinstance(report_range, dict):
            frm = cls._normalize_date(report_range.get("from"))
            to = cls._normalize_date(report_range.get("to"))
            if frm and to:
                report_range = {"from": frm, "to": to}
            else:
                report_range = None

        def norm_metric_number(value: Any, default: float = 0) -> float:
            n = cls._normalize_number(value)
            if n is None or n < 0:
                return default
            return n

        blockers_value = item.get("blockers")
        blockers: List[str] = []
        if isinstance(blockers_value, list):
            for b in blockers_value:
                text = cls._as_non_empty_str(b)
                if text:
                    blockers.append(text)

        created_at = cls._normalize_datetime(item.get("createdAt")) or now
        return {
            **item,
            "id": item_id,
            "projectId": project_id,
            "workspaceId": cls._as_non_empty_str(item.get("workspaceId")),
            "projectName": item.get("projectName"),
            "workspaceName": item.get("workspaceName"),
            "type": report_type,
            "kind": kind,
            "range": report_range,
            "format": report_format,
            "status": status,
            "startDate": cls._normalize_date(item.get("startDate")) if item.get("startDate") is not None else None,
            "endDate": cls._normalize_date(item.get("endDate")) if item.get("endDate") is not None else None,
            "duration": cls._normalize_int(item.get("duration")),
            "totalTasks": int(norm_metric_number(item.get("totalTasks"), 0)),
            "completedTasks": int(norm_metric_number(item.get("completedTasks"), 0)),
            "delayedTasks": int(norm_metric_number(item.get("delayedTasks"), 0)),
            "finalRiskScore": norm_metric_number(item.get("finalRiskScore"), 0),
            "blockers": blockers,
            "aiSummary": item.get("aiSummary") if isinstance(item.get("aiSummary"), str) else (item.get("aiSummary") or ""),
            "completionNotes": item.get("completionNotes") if isinstance(item.get("completionNotes"), str) else (item.get("completionNotes") or ""),
            "url": item.get("url"),
            "createdAt": created_at,
        }

    @classmethod
    def _normalize_project_health_best_effort(cls, item: Dict[str, Any], now: str) -> Optional[Dict[str, Any]]:
        project_id = cls._as_non_empty_str(item.get("projectId"))
        if not project_id:
            return None
        risk_score = cls._normalize_number(item.get("riskScore"))
        if risk_score is None or risk_score < 0:
            risk_score = 0.0
        risk_score = round(risk_score, 2)

        # Enforce status matches riskScore thresholds.
        status = "green"
        if risk_score >= 0.6:
            status = "red"
        elif risk_score >= 0.3:
            status = "amber"

        signals_value = item.get("signals")
        signals: List[str] = []
        if isinstance(signals_value, list):
            for s in signals_value:
                text = cls._as_non_empty_str(s)
                if text:
                    signals.append(text)
        updated_at = cls._normalize_datetime(item.get("updatedAt")) or now
        return {
            **item,
            "projectId": project_id,
            "status": status,
            "riskScore": risk_score,
            "signals": signals,
            "updatedAt": updated_at,
        }

    @classmethod
    def _normalize_job_best_effort(cls, item: Dict[str, Any], now: str) -> Optional[Dict[str, Any]]:
        item_id = cls._as_non_empty_str(item.get("id"))
        if not item_id:
            return None
        status = cls._normalize_enum(item.get("status"), mapping={}, allowed=cls._JOB_STATUSES, default="processing")
        created_at = cls._normalize_datetime(item.get("createdAt")) or now
        completed_at = cls._normalize_datetime(item.get("completedAt"))
        error = item.get("error")
        if error is not None and not isinstance(error, str):
            error = str(error)

        result_ref = item.get("resultRef")
        if result_ref is not None and not isinstance(result_ref, dict):
            result_ref = None
        if isinstance(result_ref, dict):
            ref_type = cls._as_non_empty_str(result_ref.get("type"))
            ref_pid = cls._as_non_empty_str(result_ref.get("projectId"))
            if ref_type:
                ref_type = ref_type.strip().lower()
            if ref_type not in cls._JOB_RESULT_TYPES:
                result_ref = None
            else:
                result_ref = {"type": ref_type, "projectId": ref_pid}

        # Enforce invariants best-effort
        if status == "processing":
            completed_at = None
        elif status == "completed":
            completed_at = completed_at or now
            error = None
        elif status == "failed":
            completed_at = completed_at or now
            if not cls._as_non_empty_str(error):
                error = "Job failed"

        return {
            **item,
            "id": item_id,
            "status": status,
            "resultRef": result_ref,
            "error": error,
            "createdAt": created_at,
            "completedAt": completed_at,
        }

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

        # Normalize records on read (best-effort, orphan-safe).
        try:
            _, canon = cls._canonicalize_data_best_effort(data)
            return canon
        except Exception:
            # Never block reads because of unexpected legacy/corrupt values.
            return data

    @classmethod
    def _write(cls, data: Dict[str, Any]) -> None:
        with cls._lock:
            cls._write_locked(data)

    @classmethod
    def _write_locked(cls, data: Dict[str, Any]) -> None:
        # Enforce canonical schema contract before persisting.
        data = cls._enforce_and_normalize_data_strict(data)

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
        items = list(data.get(name, []))
        # Best-effort normalization per-collection on read.
        if name in cls._CANONICAL_COLLECTIONS:
            _, canon = cls._canonicalize_data_best_effort({**data, name: items})
            return list(canon.get(name, []))
        return items

    @classmethod
    def save_collection(cls, name: str, items: List[Dict[str, Any]]) -> None:
        data = cls._read()
        data[name] = items
        cls._write(data)

    @classmethod
    def add_item(cls, name: str, item: Dict[str, Any]) -> Dict[str, Any]:
        data = cls._read()
        items = list(data.get(name, []))

        # Enforce uniqueness key at insert time to provide deterministic errors.
        new_key = item.get("projectId") if name == "project_health" else item.get("id")
        if new_key:
            for existing in items:
                existing_key = existing.get("projectId") if name == "project_health" else existing.get("id")
                if existing_key == new_key:
                    raise ConflictError("Duplicate key")

        items.append(item)
        data[name] = items
        cls._write(data)
        # Return normalized persisted record (best-effort).
        _, canon = cls._canonicalize_data_best_effort(data)
        persisted = canon.get(name, [])
        if name == "project_health":
            for r in persisted:
                if r.get("projectId") == new_key:
                    return r
        else:
            for r in persisted:
                if r.get("id") == new_key:
                    return r
        return item

    @classmethod
    def update_item(cls, name: str, item_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
        data = cls._read()
        items = list(data.get(name, []))
        updated: Optional[Dict[str, Any]] = None
        for index, item in enumerate(items):
            if item.get("id") == item_id:
                # Never allow primary key mutation.
                safe_updates = {k: v for k, v in (updates or {}).items() if k != "id"}
                items[index] = {**item, **safe_updates}
                updated = items[index]
                break
        if updated is None:
            raise NotFoundError("Item not found")
        data[name] = items
        cls._write(data)
        # Return normalized persisted record (best-effort).
        _, canon = cls._canonicalize_data_best_effort(data)
        for r in canon.get(name, []):
            if r.get("id") == item_id:
                return r
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
