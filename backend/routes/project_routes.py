from flask import Blueprint, request

from services.project_service import ProjectService
from utils.response import ok, created, no_content, error_response
from config import Config
from utils.errors import ConflictError, NotFoundError, ValidationError

project_bp = Blueprint("project_bp", __name__)


@project_bp.get("/workspaces")
def list_workspaces():
    page, page_size = ProjectService.parse_pagination(request)
    result = ProjectService.list_workspaces(page, page_size)
    return ok(result)


@project_bp.post("/workspaces")
def create_workspace():
    payload = request.get_json(silent=True) or {}
    workspace = ProjectService.create_workspace(payload)
    return created({"workspace": workspace})


@project_bp.get("/workspaces/<workspace_id>")
def get_workspace(workspace_id: str):
    workspace = ProjectService.get_workspace(workspace_id)
    return ok({"workspace": workspace})


@project_bp.patch("/workspaces/<workspace_id>")
def update_workspace(workspace_id: str):
    payload = request.get_json(silent=True) or {}
    workspace = ProjectService.update_workspace(workspace_id, payload)
    return ok({"workspace": workspace})


@project_bp.delete("/workspaces/<workspace_id>")
def delete_workspace(workspace_id: str):
    ProjectService.delete_workspace(workspace_id)
    return no_content()


@project_bp.get("/workspaces/<workspace_id>/projects")
def list_projects(workspace_id: str):
    page, page_size = ProjectService.parse_pagination(request)
    result = ProjectService.list_projects(workspace_id, page, page_size)
    return ok(result)


@project_bp.post("/workspaces/<workspace_id>/projects")
def create_project(workspace_id: str):
    payload = request.get_json(silent=True) or {}
    project = ProjectService.create_project(workspace_id, payload)
    return created({"project": project})


@project_bp.get("/projects/<project_id>")
def get_project(project_id: str):
    project = ProjectService.get_project(project_id)
    return ok({"project": project})


@project_bp.patch("/projects/<project_id>")
def update_project(project_id: str):
    payload = request.get_json(silent=True) or {}
    project = ProjectService.update_project(project_id, payload)
    return ok({"project": project})


@project_bp.delete("/projects/<project_id>")
def delete_project(project_id: str):
    ProjectService.delete_project(project_id)
    return no_content()


@project_bp.get("/projects/<project_id>/health")
def get_project_health(project_id: str):
    health = ProjectService.get_project_health(project_id)
    return ok({"health": health})


@project_bp.get("/projects/<project_id>/reports")
def list_reports(project_id: str):
    page, page_size = ProjectService.parse_pagination(request)
    result = ProjectService.list_reports(project_id, page, page_size)
    return ok(result)


@project_bp.post("/projects/<project_id>/reports")
def create_report(project_id: str):
    payload = request.get_json(silent=True) or {}
    report = ProjectService.create_report(project_id, payload)
    return created({"report": report})


@project_bp.get("/reports")
def list_all_reports():
    page, page_size = ProjectService.parse_pagination(request)
    result = ProjectService.list_all_reports(page, page_size)
    return ok(result)


@project_bp.get("/reports/<report_id>")
def get_report(report_id: str):
    report = ProjectService.get_report(report_id)
    return ok({"report": report})


@project_bp.delete("/reports/<report_id>")
def delete_report(report_id: str):
    ProjectService.delete_report(report_id)
    return no_content()


@project_bp.errorhandler(ValidationError)
def handle_validation_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="VALIDATION_ERROR",
        message=str(err),
        details={},
        status=400,
        request_id=request_id,
    )


@project_bp.errorhandler(NotFoundError)
def handle_not_found_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="NOT_FOUND",
        message=str(err),
        details={},
        status=404,
        request_id=request_id,
    )


@project_bp.errorhandler(ConflictError)
def handle_conflict_error(err):
    request_id = request.headers.get("X-Request-Id") or Config.new_id()
    return error_response(
        code="CONFLICT",
        message=str(err),
        details={},
        status=409,
        request_id=request_id,
    )
