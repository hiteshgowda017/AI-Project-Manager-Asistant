from typing import Any, Dict, List, Tuple

from services.data_service import DataService
from services.project_service import ProjectService
from utils.errors import ValidationError


class AIService:
    @staticmethod
    def parse_pagination(request) -> Tuple[int, int]:
        try:
            page = int(request.args.get("page", 1))
            page_size = int(request.args.get("pageSize", 20))
        except ValueError as exc:
            raise ValidationError("Invalid pagination values") from exc
        return page, page_size

    @staticmethod
    def list_insights(project_id: str, page: int, page_size: int) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        items = [
            item
            for item in DataService.list_collection("insights")
            if item.get("projectId") == project_id
        ]
        return DataService.paginate(items, page, page_size)

    @staticmethod
    def refresh_insights(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        job_id = DataService.new_id()
        job = {
            "id": job_id,
            "status": "processing",
            "resultRef": None,
            "error": None,
            "createdAt": DataService.now_iso(),
        }
        DataService.add_item("jobs", job)
        insights = AIService._generate_insights(project_id)
        for insight in insights:
            DataService.add_item("insights", insight)
        job_update = {
            "status": "completed",
            "resultRef": {"type": "insights", "projectId": project_id},
            "error": None,
            "completedAt": DataService.now_iso(),
        }
        DataService.update_item("jobs", job_id, job_update)
        return {"status": "accepted", "jobId": job_id}

    @staticmethod
    def _generate_insights(project_id: str) -> List[Dict[str, Any]]:
        tasks = [
            item
            for item in DataService.list_collection("tasks")
            if item.get("projectId") == project_id
        ]
        blocked = len([t for t in tasks if t.get("status") == "blocked"])
        overdue = len([t for t in tasks if t.get("dueDate")])
        insights = []
        now = DataService.now_iso()
        if blocked > 0:
            insights.append(
                {
                    "id": DataService.new_id(),
                    "projectId": project_id,
                    "type": "risk",
                    "title": "Blocked tasks detected",
                    "summary": f"{blocked} tasks are blocked and may impact delivery.",
                    "severity": "high" if blocked >= 3 else "medium",
                    "recommendations": [
                        "Review blockers with owners",
                        "Reprioritize dependent work",
                    ],
                    "createdAt": now,
                }
            )
        if overdue > 0:
            insights.append(
                {
                    "id": DataService.new_id(),
                    "projectId": project_id,
                    "type": "delivery",
                    "title": "Tasks with due dates",
                    "summary": f"{overdue} tasks have due dates; verify timelines.",
                    "severity": "low",
                    "recommendations": ["Validate due dates", "Adjust workload"],
                    "createdAt": now,
                }
            )
        if not insights:
            insights.append(
                {
                    "id": DataService.new_id(),
                    "projectId": project_id,
                    "type": "delivery",
                    "title": "Project stability looks good",
                    "summary": "No critical risk signals detected from current tasks.",
                    "severity": "low",
                    "recommendations": ["Maintain current cadence"],
                    "createdAt": now,
                }
            )
        return insights

    @staticmethod
    def generate_task_drafts(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        prompt = (payload.get("prompt") or "").strip()
        if not prompt:
            raise ValidationError("Prompt is required")
        base_titles = [
            part.strip()
            for part in prompt.replace("\n", ".").split(".")
            if part.strip()
        ]
        if not base_titles:
            base_titles = [prompt]
        drafts = []
        now = DataService.now_iso()
        for title in base_titles[:10]:
            draft = {
                "id": DataService.new_id(),
                "projectId": project_id,
                "title": title,
                "description": None,
                "status": "todo",
                "priority": payload.get("priority"),
                "assignee": payload.get("assignee"),
                "dueDate": payload.get("dueDate"),
                "estimateHours": payload.get("estimateHours"),
                "tags": payload.get("tags", []),
                "createdAt": now,
            }
            drafts.append(draft)
            DataService.add_item("task_drafts", draft)
        return {"generated": drafts}

    @staticmethod
    def commit_task_drafts(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        draft_ids = payload.get("draftIds") or []
        if not draft_ids:
            raise ValidationError("draftIds is required")
        drafts = DataService.list_collection("task_drafts")
        selected = [
            d
            for d in drafts
            if d.get("id") in draft_ids and d.get("projectId") == project_id
        ]
        if not selected:
            raise ValidationError("No drafts found for commit")
        tasks = []
        now = DataService.now_iso()
        for draft in selected:
            task = {
                "id": DataService.new_id(),
                "projectId": project_id,
                "title": draft.get("title"),
                "description": draft.get("description"),
                "status": draft.get("status", "todo"),
                "priority": draft.get("priority"),
                "assignee": draft.get("assignee"),
                "dueDate": draft.get("dueDate"),
                "estimateHours": draft.get("estimateHours"),
                "actualHours": None,
                "tags": draft.get("tags", []),
                "createdAt": now,
                "updatedAt": now,
            }
            tasks.append(DataService.add_item("tasks", task))
        remaining = [d for d in drafts if d.get("id") not in draft_ids]
        DataService.save_collection("task_drafts", remaining)
        return {"tasks": tasks}

    @staticmethod
    def create_decision(project_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        question = (payload.get("question") or "").strip()
        context = payload.get("context") or {}
        options = context.get("options") or []
        if not question:
            raise ValidationError("Question is required")
        if not options:
            raise ValidationError("At least one option is required")
        answer = options[0]
        decision = {
            "id": DataService.new_id(),
            "projectId": project_id,
            "question": question,
            "answer": answer,
            "confidence": 0.65,
            "rationale": "Selected the first option based on provided constraints.",
            "options": options,
            "tags": payload.get("tags", []),
            "createdAt": DataService.now_iso(),
        }
        DataService.add_item("decisions", decision)
        return {"decision": decision}

    @staticmethod
    def list_decisions(project_id: str, page: int, page_size: int) -> Dict[str, Any]:
        ProjectService.get_project(project_id)
        items = [
            item
            for item in DataService.list_collection("decisions")
            if item.get("projectId") == project_id
        ]
        return DataService.paginate(items, page, page_size)

