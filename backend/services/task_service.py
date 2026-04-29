from typing import Any, Dict, Tuple

from services.data_service import DataService
from services.project_service import ProjectService
from utils.errors import ValidationError


class TaskService:
    @staticmethod
    def parse_pagination(request) -> Tuple[int, int]:
        try:
            page = int(request.args.get("page", 1))
            page_size = int(request.args.get("pageSize", 50))
        except ValueError as exc:
            raise ValidationError("Invalid pagination values") from exc
        return page, page_size

    @staticmethod
    def list_tasks(project_id: str, page: int, page_size: int) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        items = [
            item
            for item in DataService.list_collection("tasks")
            if item.get("projectId") == project_id
        ]
        return DataService.paginate(items, page, page_size)

    @staticmethod
    def create_task(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        title = payload.get("title", "").strip()
        status = payload.get("status", "").strip()
        if not title:
            raise ValidationError("Task title is required")
        if not status:
            raise ValidationError("Task status is required")
        TaskService._validate_task_status(status)
        if payload.get("priority") is not None:
            TaskService._validate_task_priority(payload.get("priority"))
        now = DataService.now_iso()
        task = {
            "id": DataService.new_id(),
            "projectId": project_id,
            "title": title,
            "description": payload.get("description"),
            "status": status,
            "priority": payload.get("priority"),
            "assignee": payload.get("assignee"),
            "dueDate": payload.get("dueDate"),
            "estimateHours": payload.get("estimateHours"),
            "actualHours": payload.get("actualHours"),
            "tags": payload.get("tags", []),
            "createdAt": now,
            "updatedAt": now,
        }
        return DataService.add_item("tasks", task)

    @staticmethod
    def get_task(task_id: str) -> Dict[str, Any]:
        return DataService.get_item("tasks", task_id)

    @staticmethod
    def update_task(task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        updates = {}
        if "title" in payload:
            title = payload.get("title", "").strip()
            if not title:
                raise ValidationError("Task title cannot be empty")
            updates["title"] = title
        for field in [
            "description",
            "status",
            "priority",
            "assignee",
            "dueDate",
            "estimateHours",
            "actualHours",
            "tags",
        ]:
            if field in payload:
                updates[field] = payload.get(field)
        if "status" in updates:
            TaskService._validate_task_status(updates["status"])
        if "priority" in updates and updates["priority"] is not None:
            TaskService._validate_task_priority(updates["priority"])
        updates["updatedAt"] = DataService.now_iso()
        return DataService.update_item("tasks", task_id, updates)

    @staticmethod
    def delete_task(task_id: str) -> None:
        DataService.delete_item("tasks", task_id)

    @staticmethod
    def _validate_task_status(status: str) -> None:
        allowed = {"backlog", "todo", "in_progress", "blocked", "done"}
        if status not in allowed:
            raise ValidationError("Invalid task status")

    @staticmethod
    def _validate_task_priority(priority: str) -> None:
        allowed = {"low", "medium", "high", "critical"}
        if priority not in allowed:
            raise ValidationError("Invalid task priority")
