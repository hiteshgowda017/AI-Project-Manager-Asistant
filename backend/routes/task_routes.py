from flask import Blueprint, request

from services.task_service import TaskService
from utils.response import ok, created, no_content, error_response
from config import Config
from utils.errors import NotFoundError, ValidationError

task_bp = Blueprint("task_bp", __name__)


@task_bp.get("/projects/<project_id>/tasks")
def list_tasks(project_id: str):
    page, page_size = TaskService.parse_pagination(request)
    result = TaskService.list_tasks(project_id, page, page_size)
    return ok(result)


@task_bp.post("/projects/<project_id>/tasks")
def create_task(project_id: str):
    payload = request.get_json(silent=True) or {}
    task = TaskService.create_task(project_id, payload)
    return created({"task": task})


@task_bp.get("/tasks/<task_id>")
def get_task(task_id: str):
    task = TaskService.get_task(task_id)
    return ok({"task": task})


@task_bp.patch("/tasks/<task_id>")
def update_task(task_id: str):
    payload = request.get_json(silent=True) or {}
    task = TaskService.update_task(task_id, payload)
    return ok({"task": task})


@task_bp.delete("/tasks/<task_id>")
def delete_task(task_id: str):
    TaskService.delete_task(task_id)
    return no_content()


@task_bp.errorhandler(ValidationError)
def handle_validation_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="VALIDATION_ERROR",
        message=str(err),
        details={},
        status=400,
        request_id=request_id,
    )


@task_bp.errorhandler(NotFoundError)
def handle_not_found_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="NOT_FOUND",
        message=str(err),
        details={},
        status=404,
        request_id=request_id,
    )
