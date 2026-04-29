# API Specification (v1)

Base URL: `/api/v1`
Content-Type: `application/json`
Auth: Not required in V1 (planned for V2).

## Conventions
- All timestamps are ISO 8601 UTC strings.
- IDs are UUID strings.
- Error payloads share a common schema (see Error Responses).
- Pagination (for list endpoints): `page`, `pageSize`, `totalItems`, `totalPages`.

## Error Responses
Common error schema:
```
{
  "error": {
    "code": "STRING_CODE",
    "message": "Human-readable message",
    "details": { "any": "object" },
    "requestId": "uuid"
  }
}
```

Standard error codes:
- 400 `VALIDATION_ERROR`
- 401 `UNAUTHORIZED`
- 403 `FORBIDDEN`
- 404 `NOT_FOUND`
- 409 `CONFLICT`
- 422 `UNPROCESSABLE_ENTITY`
- 429 `RATE_LIMITED`
- 500 `INTERNAL_ERROR`

## Health
### GET /health
Response 200:
```
{ "status": "ok", "version": "1.0.0", "time": "2026-04-30T12:00:00Z" }
```

## Workspaces
### GET /workspaces
Response 200:
```
{ "items": [Workspace], "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
```

### POST /workspaces
Request:
```
{ "name": "string", "description": "string?" }
```
Response 201:
```
{ "workspace": Workspace }
```

### GET /workspaces/{workspaceId}
Response 200:
```
{ "workspace": Workspace }
```

### PATCH /workspaces/{workspaceId}
Request:
```
{ "name": "string?", "description": "string?" }
```
Response 200:
```
{ "workspace": Workspace }
```

### DELETE /workspaces/{workspaceId}
Response 204

## Projects
### GET /workspaces/{workspaceId}/projects
Response 200:
```
{ "items": [Project], "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
```

### POST /workspaces/{workspaceId}/projects
Request:
```
{ "name": "string", "description": "string?", "startDate": "date?", "endDate": "date?", "owner": "string?" }
```
Response 201:
```
{ "project": Project }
```

### GET /projects/{projectId}
Response 200:
```
{ "project": Project }
```

### PATCH /projects/{projectId}
Request:
```
{ "name": "string?", "description": "string?", "startDate": "date?", "endDate": "date?", "owner": "string?", "status": "string?" }
```
Response 200:
```
{ "project": Project }
```

### DELETE /projects/{projectId}
Response 204

## Execution Board (Tasks)
### GET /projects/{projectId}/tasks
Response 200:
```
{ "items": [Task], "page": 1, "pageSize": 50, "totalItems": 1, "totalPages": 1 }
```

### POST /projects/{projectId}/tasks
Request:
```
{ "title": "string", "description": "string?", "status": "string", "priority": "string?", "assignee": "string?", "dueDate": "date?", "estimateHours": "number?", "tags": ["string"] }
```
Response 201:
```
{ "task": Task }
```

### GET /tasks/{taskId}
Response 200:
```
{ "task": Task }
```

### PATCH /tasks/{taskId}
Request:
```
{ "title": "string?", "description": "string?", "status": "string?", "priority": "string?", "assignee": "string?", "dueDate": "date?", "estimateHours": "number?", "actualHours": "number?", "tags": ["string"] }
```
Response 200:
```
{ "task": Task }
```

### DELETE /tasks/{taskId}
Response 204

## Project Health Dashboard
### GET /projects/{projectId}/health
Response 200:
```
{ "health": ProjectHealth }
```

## AI Insights
### GET /projects/{projectId}/insights
Response 200:
```
{ "items": [Insight], "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
```

### POST /projects/{projectId}/insights/refresh
Request:
```
{ "scope": "project" }
```
Response 202:
```
{ "status": "accepted", "jobId": "uuid" }
```

## AI Task Generator
### POST /projects/{projectId}/ai/tasks
Request:
```
{ "prompt": "string", "context": { "milestones": ["string"], "constraints": ["string"] } }
```
Response 200:
```
{ "generated": [TaskDraft] }
```

### POST /projects/{projectId}/ai/tasks/commit
Request:
```
{ "draftIds": ["uuid"], "overwriteExisting": false }
```
Response 201:
```
{ "tasks": [Task] }
```

## AI Decision Assistant
### POST /projects/{projectId}/ai/decisions
Request:
```
{ "question": "string", "context": { "options": ["string"], "constraints": ["string"] } }
```
Response 200:
```
{ "decision": Decision }
```

### GET /projects/{projectId}/decisions
Response 200:
```
{ "items": [Decision], "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
```

## Reporting
### GET /projects/{projectId}/reports
Response 200:
```
{ "items": [Report], "page": 1, "pageSize": 20, "totalItems": 1, "totalPages": 1 }
```

### POST /projects/{projectId}/reports
Request:
```
{ "type": "string", "range": { "from": "date", "to": "date" }, "format": "string" }
```
Response 201:
```
{ "report": Report }
```

### GET /reports/{reportId}
Response 200:
```
{ "report": Report }
```

### DELETE /reports/{reportId}
Response 204

## Schemas
Workspace:
```
{
  "id": "uuid",
  "name": "string",
  "description": "string?",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

Project:
```
{
  "id": "uuid",
  "workspaceId": "uuid",
  "name": "string",
  "description": "string?",
  "startDate": "date?",
  "endDate": "date?",
  "owner": "string?",
  "status": "string",
  "healthStatus": "string",
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

Task:
```
{
  "id": "uuid",
  "projectId": "uuid",
  "title": "string",
  "description": "string?",
  "status": "string",
  "priority": "string?",
  "assignee": "string?",
  "dueDate": "date?",
  "estimateHours": "number?",
  "actualHours": "number?",
  "tags": ["string"],
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

ProjectHealth:
```
{
  "projectId": "uuid",
  "status": "string",
  "riskScore": "number",
  "signals": ["string"],
  "updatedAt": "datetime"
}
```

Insight:
```
{
  "id": "uuid",
  "projectId": "uuid",
  "type": "string",
  "title": "string",
  "summary": "string",
  "severity": "string",
  "recommendations": ["string"],
  "createdAt": "datetime"
}
```

TaskDraft:
```
{
  "id": "uuid",
  "projectId": "uuid",
  "title": "string",
  "description": "string?",
  "status": "string",
  "priority": "string?",
  "assignee": "string?",
  "dueDate": "date?",
  "estimateHours": "number?",
  "tags": ["string"],
  "createdAt": "datetime"
}
```

Decision:
```
{
  "id": "uuid",
  "projectId": "uuid",
  "question": "string",
  "answer": "string",
  "confidence": "number",
  "rationale": "string",
  "options": ["string"],
  "createdAt": "datetime"
}
```

Report:
```
{
  "id": "uuid",
  "projectId": "uuid",
  "type": "string",
  "range": { "from": "date", "to": "date" },
  "format": "string",
  "status": "string",
  "url": "string?",
  "createdAt": "datetime"
}
```
