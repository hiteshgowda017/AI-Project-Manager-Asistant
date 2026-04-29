# Data Model Specification (V1 JSON)

All entities stored as JSON collections. IDs are UUID strings. Timestamps are ISO 8601 UTC strings.

## Workspace
Required:
- id: uuid
- name: string
- createdAt: datetime
- updatedAt: datetime
Optional:
- description: string

Relationships:
- Workspace has many Projects.

## Project
Required:
- id: uuid
- workspaceId: uuid (FK to Workspace)
- name: string
- status: string (planned|active|on_hold|completed|archived)
- healthStatus: string (green|amber|red)
- createdAt: datetime
- updatedAt: datetime
Optional:
- description: string
- startDate: date
- endDate: date
- owner: string

Relationships:
- Project belongs to Workspace.
- Project has many Tasks.
- Project has many Insights.
- Project has many Reports.
- Project has many Decisions.

## Task
Required:
- id: uuid
- projectId: uuid (FK to Project)
- title: string
- status: string (backlog|todo|in_progress|blocked|done)
- createdAt: datetime
- updatedAt: datetime
Optional:
- description: string
- priority: string (low|medium|high|critical)
- assignee: string
- dueDate: date
- estimateHours: number
- actualHours: number
- tags: [string]

Relationships:
- Task belongs to Project.

## Insight
Required:
- id: uuid
- projectId: uuid (FK to Project)
- type: string (risk|delivery|capacity|quality|scope)
- title: string
- summary: string
- severity: string (low|medium|high|critical)
- createdAt: datetime
Optional:
- recommendations: [string]

Relationships:
- Insight belongs to Project.

## Report
Required:
- id: uuid
- projectId: uuid (FK to Project)
- type: string (status|risk|timeline|resource|executive)
- range: { from: date, to: date }
- format: string (json|csv|pdf)
- status: string (queued|processing|ready|failed)
- createdAt: datetime
Optional:
- url: string

Relationships:
- Report belongs to Project.

## Decision
Required:
- id: uuid
- projectId: uuid (FK to Project)
- question: string
- answer: string
- confidence: number (0-1)
- rationale: string
- options: [string]
- createdAt: datetime
Optional:
- tags: [string]

Relationships:
- Decision belongs to Project.
