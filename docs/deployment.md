# Deployment Architecture Spec

## Frontend Deployment Structure
- Static assets served from a CDN or static host.
- `frontend/public` as root, `frontend/src` compiled/packed to `dist` in later build step.
- Cache static assets with long TTL; HTML with short TTL.

## Backend Deployment Structure
- Flask app served by a WSGI server (gunicorn or equivalent).
- `backend/app` as application package.
- `backend/wsgi.py` as entry point.
- Reverse proxy (nginx or platform router) terminates TLS.

## Environment Variable Plan
Backend:
- `APP_ENV` (development|staging|production)
- `APP_HOST` (default 0.0.0.0)
- `APP_PORT` (default 8000)
- `DATA_PATH` (path to JSON storage)
- `LOG_LEVEL` (info|debug|warning|error)
- `API_RATE_LIMIT` (requests per minute)

Frontend:
- `APP_ENV`
- `API_BASE_URL`

## API Base URL Strategy
- In development, frontend reads `API_BASE_URL` from a local config module.
- In production, frontend reads `API_BASE_URL` injected at build time.
- Default base URL: `/api/v1` when frontend and backend are co-hosted.

## CORS Policy (Split Deployment)
- For split deployments (e.g., Vercel frontend, Render backend), enable CORS on the backend.
- Allow only production-safe origins: maintain an allowlist of exact frontend origins.
- Example allowed origins strategy: `https://app.example.com`, `https://preview-app.example.com`.
- Reject wildcard origins in production; use wildcard only in local development if needed.
- Ensure preflight (OPTIONS) requests are supported for cross-origin POST/PATCH.
