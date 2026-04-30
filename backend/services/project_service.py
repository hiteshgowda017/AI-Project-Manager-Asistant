from typing import Any, Dict, List, Tuple
from datetime import datetime, date

from services.data_service import DataService
from utils.errors import ConflictError, NotFoundError, ValidationError


class ProjectService:
    @staticmethod
    def parse_pagination(request) -> Tuple[int, int]:
        try:
            page = int(request.args.get("page", 1))
            page_size = int(request.args.get("pageSize", 20))
        except ValueError as exc:
            raise ValidationError("Invalid pagination values") from exc
        return page, page_size

    @staticmethod
    def list_workspaces(page: int, page_size: int) -> Dict[str, Any]:
        items = DataService.list_collection("workspaces")
        normalized = [ProjectService._normalize_workspace(item) for item in items]
        return DataService.paginate(normalized, page, page_size)

    @staticmethod
    def create_workspace(payload: Dict[str, Any]) -> Dict[str, Any]:
        name = payload.get("name", "").strip()
        if not name:
            raise ValidationError("Workspace name is required")
        now = DataService.now_iso()
        workspace = {
            "id": DataService.new_id(),
            "name": name,
            "description": payload.get("description"),
            "domain": payload.get("domain"),
            "createdAt": now,
            "updatedAt": now,
        }
        item = DataService.add_item("workspaces", workspace)
        return ProjectService._normalize_workspace(item)

    @staticmethod
    def get_workspace(workspace_id: str) -> Dict[str, Any]:
        item = DataService.get_item("workspaces", workspace_id)
        return ProjectService._normalize_workspace(item)

    @staticmethod
    def update_workspace(workspace_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        updates = {}
        if "name" in payload:
            name = payload.get("name", "").strip()
            if not name:
                raise ValidationError("Workspace name cannot be empty")
            updates["name"] = name
        if "description" in payload:
            updates["description"] = payload.get("description")
        if "domain" in payload:
            updates["domain"] = payload.get("domain")
        updates["updatedAt"] = DataService.now_iso()
        item = DataService.update_item("workspaces", workspace_id, updates)
        return ProjectService._normalize_workspace(item)

    @staticmethod
    def delete_workspace(workspace_id: str) -> None:
        # Phase 2: strict relationship integrity.
        # Deleting a workspace must not leave orphan projects/tasks/reports.
        DataService.get_item("workspaces", workspace_id)

        projects = DataService.list_collection("projects")
        project_ids = [p.get("id") for p in projects if p.get("workspaceId") == workspace_id and p.get("id")]
        if project_ids:
            ProjectService._cascade_delete_projects(project_ids)

        DataService.delete_item("workspaces", workspace_id)

    @staticmethod
    def list_projects(workspace_id: str, page: int, page_size: int) -> Dict[str, Any]:
        # Safe fallback: if workspace no longer exists (stale selection), return empty list.
        try:
            ProjectService.get_workspace(workspace_id)
        except NotFoundError:
            return DataService.paginate([], page, page_size)

        items = [
            item
            for item in DataService.list_collection("projects")
            if item.get("workspaceId") == workspace_id
        ]
        normalized = [ProjectService._normalize_project(item) for item in items]
        return DataService.paginate(normalized, page, page_size)

    @staticmethod
    def create_project(workspace_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_workspace(workspace_id)
        name = payload.get("name", "").strip()
        if not name:
            raise ValidationError("Project name is required")
        status = ProjectService._normalize_project_status(payload.get("status"))
        health_status = payload.get("healthStatus", "green")
        priority = ProjectService._normalize_project_priority(payload.get("priority"))
        ProjectService._validate_project_status(status)
        ProjectService._validate_health_status(health_status)
        now = DataService.now_iso()
        project = {
            "id": DataService.new_id(),
            "workspaceId": workspace_id,
            "name": name,
            "description": payload.get("description"),
            "startDate": payload.get("startDate"),
            "endDate": payload.get("endDate"),
            "owner": payload.get("owner"),
            "status": status,
            "healthStatus": health_status,
            "priority": priority,
            "progress": payload.get("progress") or 0,
            "createdAt": now,
            "updatedAt": now,
        }
        item = DataService.add_item("projects", project)
        return ProjectService._normalize_project(item)

    @staticmethod
    def get_project(project_id: str) -> Dict[str, Any]:
        item = DataService.get_item("projects", project_id)
        workspace_id = item.get("workspaceId")
        if not workspace_id:
            raise NotFoundError("Project not found")
        try:
            DataService.get_item("workspaces", workspace_id)
        except NotFoundError as exc:
            # Broken record (old/orphan). Hide it from callers.
            raise NotFoundError("Project not found") from exc
        return ProjectService._normalize_project(item)

    @staticmethod
    def update_project(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        previous = ProjectService.get_project(project_id)
        updates = {}
        if "name" in payload:
            name = payload.get("name", "").strip()
            if not name:
                raise ValidationError("Project name cannot be empty")
            updates["name"] = name
        for field in [
            "description",
            "startDate",
            "endDate",
            "owner",
            "status",
            "healthStatus",
            "priority",
            "progress",
        ]:
            if field in payload:
                updates[field] = payload.get(field)
        if "status" in updates:
            updates["status"] = ProjectService._normalize_project_status(updates["status"])
            ProjectService._validate_project_status(updates["status"])
        if "healthStatus" in updates:
            ProjectService._validate_health_status(updates["healthStatus"])
        if "priority" in updates:
            updates["priority"] = ProjectService._normalize_project_priority(updates["priority"])
        updates["updatedAt"] = DataService.now_iso()
        item = DataService.update_item("projects", project_id, updates)
        normalized = ProjectService._normalize_project(item)
        if ProjectService._should_create_completion_report(previous, normalized):
            ProjectService._create_completion_report(normalized)
        return normalized

    @staticmethod
    def delete_project(project_id: str) -> None:
        # V2: allow deletion via UI without manual cleanup.
        # Cascade-delete related records to avoid orphaned data.
        related_collections = [
            "tasks",
            "insights",
            "decisions",
            "reports",
            "task_drafts",
            "project_health",
        ]
        for collection in related_collections:
            ProjectService._delete_related_by_project_id(collection, project_id)
        DataService.delete_item("projects", project_id)

    @staticmethod
    def get_project_health(project_id: str) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        health_items = DataService.list_collection("project_health")
        for item in health_items:
            if item.get("projectId") == project_id:
                return item
        health = ProjectService._calculate_health(project_id)
        DataService.add_item("project_health", health)
        return health

    @staticmethod
    def _calculate_health(project_id: str) -> Dict[str, Any]:
        tasks = [
            item
            for item in DataService.list_collection("tasks")
            if item.get("projectId") == project_id
        ]
        total = len(tasks)
        blocked = len(
            [t for t in tasks if ProjectService._normalize_task_status(t.get("status")) == "blocked"]
        )
        in_progress = len(
            [t for t in tasks if ProjectService._normalize_task_status(t.get("status")) == "in_progress"]
        )
        review = len(
            [t for t in tasks if ProjectService._normalize_task_status(t.get("status")) == "review"]
        )
        risk_score = 0
        if total > 0:
            risk_score = (blocked * 2 + in_progress + review) / total
        status = "green"
        if risk_score >= 0.6:
            status = "red"
        elif risk_score >= 0.3:
            status = "amber"
        return {
            "projectId": project_id,
            "status": status,
            "riskScore": round(risk_score, 2),
            "signals": [
                f"Blocked tasks: {blocked}",
                f"In progress tasks: {in_progress}",
                f"In review tasks: {review}",
            ],
            "updatedAt": DataService.now_iso(),
        }

    @staticmethod
    def list_reports(project_id: str, page: int, page_size: int) -> Dict[str, Any]:
        # Safe fallback: if project no longer exists (stale selection), return empty list.
        try:
            ProjectService.get_project(project_id)
        except NotFoundError:
            return DataService.paginate([], page, page_size)

        items = [
            item
            for item in DataService.list_collection("reports")
            if item.get("projectId") == project_id
        ]
        normalized = [ProjectService._normalize_report(item) for item in items]
        return DataService.paginate(normalized, page, page_size)

    @staticmethod
    def list_all_reports(page: int, page_size: int) -> Dict[str, Any]:
        # Never return reports whose parent project no longer exists.
        project_ids = {p.get("id") for p in DataService.list_collection("projects") if p.get("id")}
        items = [r for r in DataService.list_collection("reports") if r.get("projectId") in project_ids]
        try:
            items.sort(key=lambda x: str(x.get("createdAt") or ""), reverse=True)
        except Exception:
            pass
        normalized = [ProjectService._normalize_report(item) for item in items]
        return DataService.paginate(normalized, page, page_size)

    @staticmethod
    def create_report(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        project = ProjectService.get_project(project_id)
        workspace_id = project.get("workspaceId")
        workspace_name = ProjectService._get_workspace_name(workspace_id)
        report_type = (payload.get("type") or "").strip()
        report_range = payload.get("range") or {}
        report_format = (payload.get("format") or "").strip()
        if report_type:
            ProjectService._validate_report_type(report_type)
        if report_format:
            ProjectService._validate_report_format(report_format)
        now = DataService.now_iso()
        report = {
            "id": DataService.new_id(),
            "projectId": project_id,
            "workspaceId": workspace_id,
            "projectName": project.get("name"),
            "workspaceName": workspace_name,
            "startDate": payload.get("startDate") or project.get("startDate"),
            "endDate": payload.get("endDate") or project.get("endDate"),
            "duration": payload.get("duration"),
            "totalTasks": payload.get("totalTasks"),
            "completedTasks": payload.get("completedTasks"),
            "delayedTasks": payload.get("delayedTasks"),
            "finalRiskScore": payload.get("finalRiskScore"),
            "blockers": payload.get("blockers"),
            "aiSummary": payload.get("aiSummary"),
            "completionNotes": payload.get("completionNotes"),
            "createdAt": now,
            "type": report_type or payload.get("type"),
            "range": report_range or payload.get("range"),
            "format": report_format or payload.get("format"),
            "status": payload.get("status") or "ready",
            "url": payload.get("url"),
        }
        item = DataService.add_item("reports", report)
        return ProjectService._normalize_report(item)

    @staticmethod
    def get_report(report_id: str) -> Dict[str, Any]:
        item = DataService.get_item("reports", report_id)
        project_id = item.get("projectId")
        if not project_id:
            raise NotFoundError("Report not found")
        project = ProjectService.get_project(project_id)
        workspace_name = ProjectService._get_workspace_name(project.get("workspaceId"))
        normalized = ProjectService._normalize_report(item)
        return {
            **normalized,
            "workspaceId": project.get("workspaceId"),
            "projectName": project.get("name"),
            "workspaceName": workspace_name,
        }

    @staticmethod
    def delete_report(report_id: str) -> None:
        # If the report exists but its parent project was deleted, treat it as not found.
        item = DataService.get_item("reports", report_id)
        project_id = item.get("projectId")
        if project_id:
            try:
                ProjectService.get_project(project_id)
            except NotFoundError:
                raise NotFoundError("Report not found")
        DataService.delete_item("reports", report_id)

    @staticmethod
    def _cascade_delete_projects(project_ids: List[str]) -> None:
        project_id_set = {pid for pid in project_ids if pid}
        if not project_id_set:
            return

        # Remove related records first.
        related_collections = [
            "tasks",
            "insights",
            "decisions",
            "reports",
            "task_drafts",
            "project_health",
        ]
        for collection in related_collections:
            items = DataService.list_collection(collection)
            filtered = [item for item in items if item.get("projectId") not in project_id_set]
            if len(filtered) != len(items):
                DataService.save_collection(collection, filtered)

        # Remove the projects.
        projects = DataService.list_collection("projects")
        filtered_projects = [p for p in projects if p.get("id") not in project_id_set]
        if len(filtered_projects) != len(projects):
            DataService.save_collection("projects", filtered_projects)

    @staticmethod
    def _delete_related_by_project_id(collection: str, project_id: str) -> None:
        items = DataService.list_collection(collection)
        filtered = [item for item in items if item.get("projectId") != project_id]
        if len(filtered) != len(items):
            DataService.save_collection(collection, filtered)

    @staticmethod
    def _normalize_workspace(item: Dict[str, Any]) -> Dict[str, Any]:
        now = DataService.now_iso()
        return {
            "id": item.get("id"),
            "name": item.get("name") or "Untitled",
            "description": item.get("description"),
            "domain": item.get("domain"),
            "createdAt": item.get("createdAt") or now,
            "updatedAt": item.get("updatedAt") or item.get("createdAt") or now,
        }

    @staticmethod
    def _normalize_project(item: Dict[str, Any]) -> Dict[str, Any]:
        now = DataService.now_iso()
        status = ProjectService._normalize_project_status(item.get("status"))
        priority = ProjectService._normalize_project_priority(item.get("priority"))
        progress = item.get("progress")
        if progress is None:
            progress = ProjectService._calculate_progress(item.get("id"))
        return {
            **item,
            "status": status,
            "priority": priority,
            "progress": progress,
            "description": item.get("description"),
            "startDate": item.get("startDate"),
            "endDate": item.get("endDate"),
            "owner": item.get("owner"),
            "createdAt": item.get("createdAt") or now,
            "updatedAt": item.get("updatedAt") or item.get("createdAt") or now,
        }

    @staticmethod
    def _normalize_report(item: Dict[str, Any]) -> Dict[str, Any]:
        now = DataService.now_iso()
        return {
            **item,
            "workspaceId": item.get("workspaceId"),
            "projectName": item.get("projectName"),
            "workspaceName": item.get("workspaceName"),
            "startDate": item.get("startDate"),
            "endDate": item.get("endDate"),
            "duration": item.get("duration"),
            "totalTasks": item.get("totalTasks") or 0,
            "completedTasks": item.get("completedTasks") or 0,
            "delayedTasks": item.get("delayedTasks") or 0,
            "finalRiskScore": item.get("finalRiskScore") or 0,
            "blockers": item.get("blockers") or [],
            "aiSummary": item.get("aiSummary") or "",
            "completionNotes": item.get("completionNotes") or "",
            "createdAt": item.get("createdAt") or now,
        }

    @staticmethod
    def _normalize_project_priority(priority: Any) -> Any:
        if priority is None:
            return None
        value = str(priority).strip().lower()
        if not value:
            return None
        mapping = {"low": "low", "medium": "medium", "high": "high"}
        return mapping.get(value, value)

    @staticmethod
    def _normalize_project_status(status: Any) -> str:
        if status is None:
            return "planned"
        value = str(status).strip().lower().replace(" ", "_")
        mapping = {
            "planned": "planned",
            "active": "active",
            "blocked": "blocked",
            "completed": "completed",
            "in_progress": "active",
            "inprogress": "active",
            "on_hold": "on_hold",
            "archived": "archived",
        }
        return mapping.get(value, value)

    @staticmethod
    def _normalize_task_status(status: Any) -> str:
        if status is None:
            return "planned"
        value = str(status).strip().lower().replace(" ", "_")
        mapping = {
            "todo": "planned",
            "backlog": "planned",
            "planned": "planned",
            "in_progress": "in_progress",
            "review": "review",
            "done": "completed",
            "completed": "completed",
            "blocked": "blocked",
        }
        return mapping.get(value, value)

    @staticmethod
    def _calculate_progress(project_id: Any) -> int:
        if not project_id:
            return 0
        tasks = [
            item
            for item in DataService.list_collection("tasks")
            if item.get("projectId") == project_id
        ]
        total = len(tasks)
        if total == 0:
            return 0
        completed = len(
            [t for t in tasks if ProjectService._normalize_task_status(t.get("status")) == "completed"]
        )
        return round((completed / total) * 100)

    @staticmethod
    def _should_create_completion_report(previous: Dict[str, Any], current: Dict[str, Any]) -> bool:
        before = ProjectService._normalize_project_status(previous.get("status"))
        after = ProjectService._normalize_project_status(current.get("status"))
        if after != "completed" or before == "completed":
            return False
        existing = [
            r
            for r in DataService.list_collection("reports")
            if r.get("projectId") == current.get("id") and r.get("kind") == "completion"
        ]
        return len(existing) == 0

    @staticmethod
    def _create_completion_report(project: Dict[str, Any]) -> Dict[str, Any]:
        tasks = [
            item
            for item in DataService.list_collection("tasks")
            if item.get("projectId") == project.get("id")
        ]
        total = len(tasks)
        completed = len(
            [t for t in tasks if ProjectService._normalize_task_status(t.get("status")) == "completed"]
        )
        delayed = len([t for t in tasks if ProjectService._is_task_delayed(t)])
        blockers = [
            t.get("title")
            for t in tasks
            if ProjectService._normalize_task_status(t.get("status")) == "blocked"
        ]
        health = ProjectService._calculate_health(project.get("id"))
        start_date = project.get("startDate")
        end_date = project.get("endDate") or DataService.now_iso()
        duration = ProjectService._calculate_duration(start_date, end_date)
        report = {
            "id": DataService.new_id(),
            "kind": "completion",
            "projectId": project.get("id"),
            "workspaceId": project.get("workspaceId"),
            "projectName": project.get("name"),
            "workspaceName": ProjectService._get_workspace_name(project.get("workspaceId")),
            "startDate": start_date,
            "endDate": end_date,
            "duration": duration,
            "totalTasks": total,
            "completedTasks": completed,
            "delayedTasks": delayed,
            "finalRiskScore": health.get("riskScore"),
            "blockers": blockers,
            "aiSummary": ProjectService._build_ai_summary(project, total, completed, delayed),
            "completionNotes": "",
            "createdAt": DataService.now_iso(),
        }
        return DataService.add_item("reports", report)

    @staticmethod
    def _calculate_duration(start_date: Any, end_date: Any) -> Any:
        start = ProjectService._parse_date(start_date)
        end = ProjectService._parse_date(end_date)
        if not start or not end:
            return None
        return (end - start).days

    @staticmethod
    def _parse_date(value: Any) -> Any:
        if not value:
            return None
        if isinstance(value, date):
            return value
        text = str(value)
        try:
            return datetime.fromisoformat(text.replace("Z", "+00:00")).date()
        except ValueError:
            return None

    @staticmethod
    def _is_task_delayed(task: Dict[str, Any]) -> bool:
        due_date = ProjectService._parse_date(task.get("dueDate"))
        if not due_date:
            return False
        status = ProjectService._normalize_task_status(task.get("status"))
        if status == "completed":
            return False
        return due_date < datetime.utcnow().date()

    @staticmethod
    def _get_workspace_name(workspace_id: Any) -> Any:
        if not workspace_id:
            return None
        try:
            item = DataService.get_item("workspaces", workspace_id)
        except Exception:
            return None
        return item.get("name")

    @staticmethod
    def _build_ai_summary(project: Dict[str, Any], total: int, completed: int, delayed: int) -> str:
        if total == 0:
            return "Project completed with no tracked tasks."
        completion_rate = round((completed / total) * 100)
        if delayed > 0:
            return f"Completion reached {completion_rate}% with {delayed} delayed tasks to review."
        return f"Completion reached {completion_rate}% with no delayed tasks detected."

    @staticmethod
    def _validate_project_status(status: str) -> None:
        allowed = {"planned", "active", "blocked", "on_hold", "completed", "archived"}
        if status not in allowed:
            raise ValidationError("Invalid project status")

    @staticmethod
    def _validate_health_status(status: str) -> None:
        allowed = {"green", "amber", "red"}
        if status not in allowed:
            raise ValidationError("Invalid project health status")

    @staticmethod
    def _validate_report_type(report_type: str) -> None:
        allowed = {"status", "risk", "timeline", "resource", "executive"}
        if report_type not in allowed:
            raise ValidationError("Invalid report type")

    @staticmethod
    def _validate_report_format(report_format: str) -> None:
        allowed = {"json", "csv", "pdf"}
        if report_format not in allowed:
            raise ValidationError("Invalid report format")
