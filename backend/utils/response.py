from typing import Any, Dict, Optional, Tuple
from flask import jsonify


def ok(payload: Dict[str, Any], status_code: int = 200) -> Tuple[Any, int]:
    return jsonify(payload), status_code


def created(payload: Dict[str, Any], status_code: int = 201) -> Tuple[Any, int]:
    return jsonify(payload), status_code


def no_content() -> Tuple[Any, int]:
    return "", 204


def error_response(
    code: str,
    message: str,
    details: Optional[Dict[str, Any]],
    status: int,
    request_id: str,
) -> Tuple[Any, int]:
    payload = {
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
            "requestId": request_id,
        }
    }
    return jsonify(payload), status
