from typing import Any, Dict, Tuple

from services.data_service import DataService
from utils.errors import ConflictError, ValidationError


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
        return DataService.paginate(items, page, page_size)

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
            "createdAt": now,
            "updatedAt": now,
        }
        return DataService.add_item("workspaces", workspace)

    @staticmethod
    def get_workspace(workspace_id: str) -> Dict[str, Any]:
        return DataService.get_item("workspaces", workspace_id)

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
        updates["updatedAt"] = DataService.now_iso()
        return DataService.update_item("workspaces", workspace_id, updates)

    @staticmethod
    def delete_workspace(workspace_id: str) -> None:
        projects = DataService.list_collection("projects")
        if any(item.get("workspaceId") == workspace_id for item in projects):
            raise ConflictError("Workspace has projects and cannot be deleted")
        DataService.delete_item("workspaces", workspace_id)

    @staticmethod
    def list_projects(workspace_id: str, page: int, page_size: int) -> Dict[str, Any]:
        items = [
            item
            for item in DataService.list_collection("projects")
            if item.get("workspaceId") == workspace_id
        ]
        return DataService.paginate(items, page, page_size)

    @staticmethod
    def create_project(workspace_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_workspace(workspace_id)
        name = payload.get("name", "").strip()
        if not name:
            raise ValidationError("Project name is required")
        status = payload.get("status", "planned")
        health_status = payload.get("healthStatus", "green")
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
            "createdAt": now,
            "updatedAt": now,
        }
        return DataService.add_item("projects", project)

    @staticmethod
    def get_project(project_id: str) -> Dict[str, Any]:
        return DataService.get_item("projects", project_id)

    @staticmethod
    def update_project(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
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
        ]:
            if field in payload:
                updates[field] = payload.get(field)
        if "status" in updates:
            ProjectService._validate_project_status(updates["status"])
        if "healthStatus" in updates:
            ProjectService._validate_health_status(updates["healthStatus"])
        updates["updatedAt"] = DataService.now_iso()
        return DataService.update_item("projects", project_id, updates)

    @staticmethod
    def delete_project(project_id: str) -> None:
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
            if any(item.get("projectId") == project_id for item in items):
                raise ConflictError("Project has related records and cannot be deleted")
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
        blocked = len([t for t in tasks if t.get("status") == "blocked"])
        in_progress = len([t for t in tasks if t.get("status") == "in_progress"])
        risk_score = 0
        if total > 0:
            risk_score = (blocked * 2 + in_progress) / total
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
            ],
            "updatedAt": DataService.now_iso(),
        }

    @staticmethod
    def list_reports(project_id: str, page: int, page_size: int) -> Dict[str, Any]:
        items = [
            item
            for item in DataService.list_collection("reports")
            if item.get("projectId") == project_id
        ]
        return DataService.paginate(items, page, page_size)

    @staticmethod
    def create_report(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        report_type = payload.get("type", "").strip()
        report_range = payload.get("range") or {}
        report_format = payload.get("format", "").strip()
        if not report_type:
            raise ValidationError("Report type is required")
        ProjectService._validate_report_type(report_type)
        if not report_range.get("from") or not report_range.get("to"):
            raise ValidationError("Report range requires from/to")
        if not report_format:
            raise ValidationError("Report format is required")
        ProjectService._validate_report_format(report_format)
        now = DataService.now_iso()
        report = {
            "id": DataService.new_id(),
            "projectId": project_id,
            "type": report_type,
            "range": report_range,
            "format": report_format,
            "status": "ready",
            "url": payload.get("url"),
            "createdAt": now,
        }
        return DataService.add_item("reports", report)

    @staticmethod
    def get_report(report_id: str) -> Dict[str, Any]:
        return DataService.get_item("reports", report_id)

    @staticmethod
    def delete_report(report_id: str) -> None:
        DataService.delete_item("reports", report_id)

    @staticmethod
    def _validate_project_status(status: str) -> None:
        allowed = {"planned", "active", "on_hold", "completed", "archived"}
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
