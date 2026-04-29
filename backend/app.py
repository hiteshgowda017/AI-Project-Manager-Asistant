from flask import Flask, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException

from config import Config
from routes.project_routes import project_bp
from routes.task_routes import task_bp
from routes.ai_routes import ai_bp
from utils.response import error_response
from services.data_service import DataService


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config())

    data_path = app.config["DATA_PATH"]
    DataService.initialize(data_path)

    cors_origins = app.config["CORS_ALLOWED_ORIGINS"]

    if cors_origins:
        CORS(app, resources={r"/api/*": {"origins": cors_origins}})
    elif app.config["APP_ENV"] != "production":
        CORS(app, resources={r"/api/*": {"origins": "*"}})

    app.register_blueprint(project_bp, url_prefix="/api/v1")
    app.register_blueprint(task_bp, url_prefix="/api/v1")
    app.register_blueprint(ai_bp, url_prefix="/api/v1")

    @app.get("/api/v1/health")
    def health():
        return {
            "status": "ok",
            "version": app.config["APP_VERSION"],
            "time": Config.utcnow_iso(),
        }, 200

    @app.errorhandler(HTTPException)
    def handle_http_exception(err):
        request_id = request.headers.get("X-Request-Id") or Config.new_id()
        return error_response(
            code=err.name.upper().replace(" ", "_"),
            message=err.description,
            details={"type": type(err).__name__},
            status=err.code,
            request_id=request_id,
        )

    @app.errorhandler(Exception)
    def handle_unexpected_error(err):
        request_id = request.headers.get("X-Request-Id") or Config.new_id()
        return error_response(
            code="INTERNAL_ERROR",
            message="Unexpected server error",
            details={"type": type(err).__name__},
            status=500,
            request_id=request_id,
        )

    return app


if __name__ == "__main__":
    app = create_app()
    host = app.config["APP_HOST"]
    port = int(app.config["APP_PORT"])
    debug = app.config["APP_ENV"] != "production"
    app.run(host=host, port=port, debug=debug)