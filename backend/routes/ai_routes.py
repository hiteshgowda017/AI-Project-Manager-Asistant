from flask import Blueprint, request

from services.ai_service import AIService
from utils.response import ok, created, error_response
from config import Config
from utils.errors import NotFoundError, ValidationError

ai_bp = Blueprint("ai_bp", __name__)


@ai_bp.get("/projects/<project_id>/insights")
def list_insights(project_id: str):
    page, page_size = AIService.parse_pagination(request)
    result = AIService.list_insights(project_id, page, page_size)
    return ok(result)


@ai_bp.post("/projects/<project_id>/insights/refresh")
def refresh_insights(project_id: str):
    payload = request.get_json(silent=True) or {}
    job = AIService.refresh_insights(project_id, payload)
    return created(job, status_code=202)


@ai_bp.post("/projects/<project_id>/ai/tasks")
def generate_tasks(project_id: str):
    payload = request.get_json(silent=True) or {}
    result = AIService.generate_task_drafts(project_id, payload)
    return ok(result)


@ai_bp.post("/projects/<project_id>/ai/tasks/commit")
def commit_task_drafts(project_id: str):
    payload = request.get_json(silent=True) or {}
    result = AIService.commit_task_drafts(project_id, payload)
    return created(result)


@ai_bp.post("/projects/<project_id>/ai/decisions")
def create_decision(project_id: str):
    payload = request.get_json(silent=True) or {}
    result = AIService.create_decision(project_id, payload)
    return ok(result)


@ai_bp.get("/projects/<project_id>/decisions")
def list_decisions(project_id: str):
    page, page_size = AIService.parse_pagination(request)
    result = AIService.list_decisions(project_id, page, page_size)
    return ok(result)


@ai_bp.errorhandler(ValidationError)
def handle_validation_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="VALIDATION_ERROR",
        message=str(err),
        details={},
        status=400,
        request_id=request_id,
    )


@ai_bp.errorhandler(NotFoundError)
def handle_not_found_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="NOT_FOUND",
        message=str(err),
        details={},
        status=404,
        request_id=request_id,
    )
