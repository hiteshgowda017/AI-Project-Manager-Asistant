from typing import Any, Dict, Tuple, List
from datetime import datetime, date

from services.data_service import DataService
from services.project_service import ProjectService
from utils.errors import NotFoundError, ValidationError


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
        # Safe fallback: if project no longer exists (stale selection), return empty list.
        try:
            ProjectService.get_project(project_id)
        except NotFoundError:
            return DataService.paginate([], page, page_size)
        items = [
            item
            for item in DataService.list_collection("tasks")
            if item.get("projectId") == project_id
        ]
        normalized = [TaskService._normalize_task(item) for item in items]
        return DataService.paginate(normalized, page, page_size)

    @staticmethod
    def create_task(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        title = payload.get("title", "").strip()
        status = TaskService._normalize_task_status(payload.get("status"))
        if not title:
            raise ValidationError("Task title is required")
        if not status:
            raise ValidationError("Task status is required")
        TaskService._validate_task_status(status)
        priority = TaskService._normalize_task_priority(payload.get("priority"))
        if priority is not None:
            TaskService._validate_task_priority(priority)
        assigned_to = TaskService._normalize_assigned_to(payload.get("assignedTo") or payload.get("assignee"))
        due_date = payload.get("dueDate")
        if due_date is not None and TaskService._parse_date(due_date) is None:
            raise ValidationError("Invalid dueDate")

        estimate_hours = payload.get("estimateHours")
        if estimate_hours is not None:
            estimate_hours = TaskService._normalize_number(estimate_hours, "estimateHours")

        actual_hours = payload.get("actualHours")
        if actual_hours is not None:
            actual_hours = TaskService._normalize_number(actual_hours, "actualHours")

        tags = TaskService._normalize_tags(payload.get("tags"))
        ai_suggestion = payload.get("aiSuggestion")
        if ai_suggestion is not None and not isinstance(ai_suggestion, (str, dict, list)):
            raise ValidationError("Invalid aiSuggestion")
        now = DataService.now_iso()
        task = {
            "id": DataService.new_id(),
            "projectId": project_id,
            "title": title,
            "description": payload.get("description"),
            "status": status,
            "priority": priority,
            "assignedTo": assigned_to,
            "assignee": assigned_to,
            "dueDate": due_date,
            "aiSuggestion": ai_suggestion,
            "estimateHours": estimate_hours,
            "actualHours": actual_hours,
            "tags": tags,
            "createdAt": now,
            "updatedAt": now,
        }
        item = DataService.add_item("tasks", task)
        return TaskService._normalize_task(item)

    @staticmethod
    def get_task(task_id: str) -> Dict[str, Any]:
        item = DataService.get_item("tasks", task_id)
        project_id = item.get("projectId")
        if not project_id:
            raise NotFoundError("Task not found")
        try:
            ProjectService.get_project(project_id)
        except NotFoundError as exc:
            raise NotFoundError("Task not found") from exc
        return TaskService._normalize_task(item)

    @staticmethod
    def update_task(task_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        existing = DataService.get_item("tasks", task_id)
        project_id = existing.get("projectId")
        if not project_id:
            raise NotFoundError("Task not found")
        try:
            ProjectService.get_project(project_id)
        except NotFoundError as exc:
            raise NotFoundError("Task not found") from exc

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
            "assignedTo",
            "dueDate",
            "aiSuggestion",
            "estimateHours",
            "actualHours",
            "tags",
        ]:
            if field in payload:
                updates[field] = payload.get(field)
        if "status" in updates:
            updates["status"] = TaskService._normalize_task_status(updates["status"])
            TaskService._validate_task_status(updates["status"])
        if "priority" in updates:
            updates["priority"] = TaskService._normalize_task_priority(updates["priority"])
            if updates["priority"] is not None:
                TaskService._validate_task_priority(updates["priority"])
        if "assignedTo" in updates or "assignee" in updates:
            assigned_to = TaskService._normalize_assigned_to(updates.get("assignedTo") or updates.get("assignee"))
            updates["assignedTo"] = assigned_to
            updates["assignee"] = assigned_to

        if "dueDate" in updates:
            due_date = updates.get("dueDate")
            if due_date is not None and TaskService._parse_date(due_date) is None:
                raise ValidationError("Invalid dueDate")

        if "estimateHours" in updates and updates.get("estimateHours") is not None:
            updates["estimateHours"] = TaskService._normalize_number(updates.get("estimateHours"), "estimateHours")

        if "actualHours" in updates and updates.get("actualHours") is not None:
            updates["actualHours"] = TaskService._normalize_number(updates.get("actualHours"), "actualHours")

        if "tags" in updates:
            updates["tags"] = TaskService._normalize_tags(updates.get("tags"))

        if "aiSuggestion" in updates:
            ai_suggestion = updates.get("aiSuggestion")
            if ai_suggestion is not None and not isinstance(ai_suggestion, (str, dict, list)):
                raise ValidationError("Invalid aiSuggestion")

        updates["updatedAt"] = DataService.now_iso()
        item = DataService.update_item("tasks", task_id, updates)
        return TaskService._normalize_task(item)

    @staticmethod
    def _normalize_assigned_to(value: Any) -> Any:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _normalize_tags(value: Any) -> List[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValidationError("Invalid tags")
        normalized: List[str] = []
        for item in value:
            if item is None:
                continue
            text = str(item).strip()
            if text:
                normalized.append(text)
        return normalized

    @staticmethod
    def _normalize_number(value: Any, field_name: str) -> float:
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise ValidationError(f"Invalid {field_name}") from exc
        if number < 0:
            raise ValidationError(f"Invalid {field_name}")
        return number

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
    def delete_task(task_id: str) -> None:
        DataService.delete_item("tasks", task_id)

    @staticmethod
    def _validate_task_status(status: str) -> None:
        allowed = {"planned", "in_progress", "review", "blocked", "completed"}
        if status not in allowed:
            raise ValidationError("Invalid task status")

    @staticmethod
    def _validate_task_priority(priority: str) -> None:
        allowed = {"low", "medium", "high", "critical"}
        if priority not in allowed:
            raise ValidationError("Invalid task priority")

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
    def _normalize_task_priority(priority: Any) -> Any:
        if priority is None:
            return None
        value = str(priority).strip().lower()
        if not value:
            return None
        mapping = {"low": "low", "medium": "medium", "high": "high", "critical": "critical"}
        return mapping.get(value, value)

    @staticmethod
    def _normalize_task(item: Dict[str, Any]) -> Dict[str, Any]:
        now = DataService.now_iso()
        status = TaskService._normalize_task_status(item.get("status"))
        priority = TaskService._normalize_task_priority(item.get("priority"))
        assigned_to = item.get("assignedTo") or item.get("assignee")
        return {
            **item,
            "status": status,
            "priority": priority,
            "assignedTo": assigned_to,
            "assignee": assigned_to,
            "aiSuggestion": item.get("aiSuggestion"),
            "createdAt": item.get("createdAt") or now,
            "updatedAt": item.get("updatedAt") or item.get("createdAt") or now,
        }
