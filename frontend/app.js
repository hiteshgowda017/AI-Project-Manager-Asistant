(() => {
  "use strict";

  // Production backend (Render)
  const API_BASE_URL = "https://ai-pm-backend-0lfc.onrender.com/api/v1";

  // ---------- Utilities ----------
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function normalizeErrorMessage(err) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err instanceof Error && err.message) return err.message;
    try {
      return String(err);
    } catch {
      return "Unknown error";
    }
  }

  // Prevent unhandled promise rejections from breaking interactivity
  window.addEventListener("unhandledrejection", (event) => {
    try {
      console.error("Unhandled promise rejection:", event.reason);
      // Keep app interactive; show toast if possible
      ui?.toast?.(normalizeErrorMessage(event.reason));
    } catch {
      // ignore
    }
  });

  // ---------- State ----------
  const state = {
    workspaces: [],
    projects: [],
    tasks: [],
    insights: [],
    reports: [],
    taskDrafts: [],
    decisions: [],
    activeWorkspaceId: null,
    activeProjectId: null,
    activeReportId: null,
    apiOnline: null, // null | true | false
  };

  // ---------- Element cache ----------
  const el = {};

  function cacheElements() {
    // Lists / panels
    el.workspaceList = document.getElementById("workspaceList");
    el.projectList = document.getElementById("projectList");
    el.reportList = document.getElementById("reportList");
    el.reportCount = document.getElementById("reportCount");
    el.reportDetail = document.getElementById("reportDetail");
    el.reportStatus = document.getElementById("reportStatus");

    el.activeProjectName = document.getElementById("activeProjectName");
    el.activeProjectMeta = document.getElementById("activeProjectMeta");
    el.projectTimeline = document.getElementById("projectTimeline");
    el.projectOwnerDisplay = document.getElementById("projectOwnerDisplay");
    el.projectProgressText = document.getElementById("projectProgressText");
    el.projectProgressBar = document.getElementById("projectProgressBar");
    el.projectPriorityDisplay = document.getElementById("projectPriorityDisplay");
    el.projectStatusDisplay = document.getElementById("projectStatusDisplay");

    el.markProjectCompletedButton = document.getElementById("markProjectCompletedButton");

    el.plannedColumn = document.getElementById("plannedColumn");
    el.progressColumn = document.getElementById("progressColumn");
    el.reviewColumn = document.getElementById("reviewColumn");
    el.doneColumn = document.getElementById("doneColumn");
    el.blockedColumn = document.getElementById("blockedColumn");

    el.insightList = document.getElementById("insightList");
    el.insightCount = document.getElementById("insightCount");
    el.riskList = document.getElementById("riskList");
    el.suggestionList = document.getElementById("suggestionList");

    el.healthPanel = document.getElementById("healthPanel");
    el.healthStatus = document.getElementById("healthStatus");
    el.healthScore = document.getElementById("healthScore");
    el.healthSignals = document.getElementById("healthSignals");

    // Forms
    el.workspaceForm = document.getElementById("workspaceForm");
    el.workspaceName = document.getElementById("workspaceName");
    el.workspaceDescription = document.getElementById("workspaceDescription");
    el.workspaceDomain = document.getElementById("workspaceDomain");

    el.projectForm = document.getElementById("projectForm");
    el.projectName = document.getElementById("projectName");
    el.projectDescription = document.getElementById("projectDescription");
    el.projectStartDate = document.getElementById("projectStartDate");
    el.projectEndDate = document.getElementById("projectEndDate");
    el.projectOwnerInput = document.getElementById("projectOwner");
    el.projectPriority = document.getElementById("projectPriority");
    el.projectStatus = document.getElementById("projectStatus");

    el.taskForm = document.getElementById("taskForm");
    el.taskTitle = document.getElementById("taskTitle");
    el.taskDescription = document.getElementById("taskDescription");
    el.taskStatus = document.getElementById("taskStatus");
    el.taskPriority = document.getElementById("taskPriority");
    el.taskDueDate = document.getElementById("taskDueDate");
    el.taskAssignedTo = document.getElementById("taskAssignedTo");

    // AI task generator
    el.aiTaskPrompt = document.getElementById("aiTaskPrompt");
    el.generateTasksButton = document.getElementById("generateTasksButton");
    el.taskDraftList = document.getElementById("taskDraftList");
    el.commitTasksButton = document.getElementById("commitTasksButton");

    // AI decision assistant
    el.decisionQuestion = document.getElementById("decisionQuestion");
    el.decisionOptions = document.getElementById("decisionOptions");
    el.askDecisionButton = document.getElementById("askDecisionButton");
    el.decisionList = document.getElementById("decisionList");

    // Status / notifications
    el.apiStatusInline = document.getElementById("apiStatusInline"); // dashboard badge
    el.toast = document.getElementById("toast");

    // Landing
    el.apiStatus = document.getElementById("apiStatus"); // landing panel
    el.demoTrigger = document.getElementById("demoTrigger");
  }

  // ---------- UI helpers ----------
  const ui = {
    toast(message) {
      try {
        if (!el.toast) return;
        const msg = (message || "").toString().trim();
        if (!msg) return;
        el.toast.textContent = msg;
        el.toast.style.display = "block";
        setTimeout(() => {
          try {
            el.toast.style.display = "none";
          } catch {
            // ignore
          }
        }, 2800);
      } catch {
        // ignore
      }
    },

    setButtonLoading(button, isLoading, label) {
      try {
        if (!button) return;
        if (isLoading) {
          button.dataset.originalText = button.textContent;
          button.textContent = label || "Loading...";
          button.disabled = true;
          button.setAttribute("aria-busy", "true");
        } else {
          button.textContent = button.dataset.originalText || button.textContent;
          button.disabled = false;
          button.removeAttribute("aria-busy");
        }
      } catch {
        // ignore
      }
    },

    setApiStatusChecking(target) {
      try {
        if (!target) return;
        if (target.id === "apiStatusInline") {
          // Inline badge style: dot + label
          const dot = target.querySelector(".dot");
          const label = target.querySelector("span:last-child");
          if (label) label.textContent = "API: Checking...";
          if (dot) dot.style.background = "#f0b429"; // amber
          return;
        }

        // Landing status block
        target.innerHTML = `
          <span class="status-pill">API: Checking...</span>
          <span class="status-text"></span>
        `;
      } catch {
        // ignore
      }
    },

    setApiBadge(target, isOnline, timeText) {
      try {
        if (!target) return;

        if (target.id === "apiStatusInline") {
          const dot = target.querySelector(".dot");
          const label = target.querySelector("span:last-child");
          if (label) label.textContent = isOnline ? "API: Online" : "API: Offline";
          if (dot) dot.style.background = isOnline ? "#0f7b6c" : "#d0586f";
          return;
        }

        target.innerHTML = `
          <span class="status-pill">API: ${isOnline ? "Online" : "Offline"}</span>
          <span class="status-text">${timeText ? String(timeText) : ""}</span>
        `;
      } catch {
        // ignore
      }
    },

    setInteractiveDisabled(container, disabled) {
      try {
        if (!container) return;
        const controls = container.querySelectorAll("button, input, select, textarea");
        controls.forEach((c) => {
          // Don't permanently lock UI just because API is offline.
          // Only use this if you add a "global busy" later.
          c.disabled = !!disabled;
        });
      } catch {
        // ignore
      }
    },
  };

  // ---------- API layer ----------
  const api = {
    async request(path, options = {}) {
      const controller = new AbortController();
      const timeoutMs = typeof options.timeoutMs === "number" ? options.timeoutMs : 20000;

      const id = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(`${API_BASE_URL}${path}`, {
          method: options.method || "GET",
          headers: {
            "Content-Type": "application/json",
            ...(options.headers || {}),
          },
          body: options.body,
          signal: controller.signal,
        });

        const contentType = response.headers.get("content-type") || "";
        const isJson = contentType.includes("application/json");

        if (!response.ok) {
          let message = `Request failed (${response.status})`;

          if (isJson) {
            const payload = await response.json().catch(() => ({}));
            message =
              payload?.error?.message ||
              payload?.message ||
              payload?.error ||
              message;
          } else {
            const text = await response.text().catch(() => "");
            const parsed = safeJsonParse(text);
            message =
              parsed?.error?.message ||
              parsed?.message ||
              (text && text.slice(0, 200)) ||
              message;
          }

          throw new Error(message);
        }

        if (response.status === 204) return null;
        if (isJson) return response.json();

        // fallback (shouldn't happen for this API, but safe)
        return response.text();
      } catch (err) {
        // Provide better message for aborts / network errors
        if (err?.name === "AbortError") {
          throw new Error("Request timed out. Please try again.");
        }
        throw err;
      } finally {
        clearTimeout(id);
      }
    },

    health: () => api.request("/health", { timeoutMs: 10000 }),

    listWorkspaces: (page = 1) => api.request(`/workspaces?page=${page}`),
    createWorkspace: (data) =>
      api.request("/workspaces", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteWorkspace: (workspaceId) =>
      api.request(`/workspaces/${workspaceId}`, { method: "DELETE" }),

    listProjects: (workspaceId) => api.request(`/workspaces/${workspaceId}/projects`),
    createProject: (workspaceId, data) =>
      api.request(`/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    deleteProject: (projectId) =>
      api.request(`/projects/${projectId}`, { method: "DELETE" }),

    updateProject: (projectId, data) =>
      api.request(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),

    listTasks: (projectId) => api.request(`/projects/${projectId}/tasks`),
    createTask: (projectId, data) =>
      api.request(`/projects/${projectId}/tasks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateTask: (taskId, data) =>
      api.request(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    deleteTask: (taskId) => api.request(`/tasks/${taskId}`, { method: "DELETE" }),

    listInsights: (projectId) => api.request(`/projects/${projectId}/insights`),
    refreshInsights: (projectId) =>
      api.request(`/projects/${projectId}/insights/refresh`, {
        method: "POST",
        body: JSON.stringify({ scope: "project" }),
      }),

    generateTaskDrafts: (projectId, data) =>
      api.request(`/projects/${projectId}/ai/tasks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    commitTaskDrafts: (projectId, data) =>
      api.request(`/projects/${projectId}/ai/tasks/commit`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    createDecision: (projectId, data) =>
      api.request(`/projects/${projectId}/ai/decisions`, {
        method: "POST",
        body: JSON.stringify(data),
      }),

    getHealth: (projectId) => api.request(`/projects/${projectId}/health`),

    listReports: (page = 1) => api.request(`/reports?page=${page}`),
    getReport: (reportId) => api.request(`/reports/${reportId}`),
  };

  // ---------- Renderers ----------
  const render = {
    workspaces() {
      try {
        if (!el.workspaceList) return;
        el.workspaceList.innerHTML = "";

        if (!Array.isArray(state.workspaces) || state.workspaces.length === 0) {
          el.workspaceList.innerHTML = '<div class="muted">No workspaces yet.</div>';
          return;
        }

        state.workspaces.forEach((workspace) => {
          const item = document.createElement("div");
          item.className = "list-item";
          if (workspace?.id === state.activeWorkspaceId) item.classList.add("list-item--active");
          const createdAt = formatDate(workspace?.createdAt);
          const domain = workspace?.domain ? `Domain: ${workspace.domain}` : "Domain: --";
          item.innerHTML = `
            <div class="list-item__meta">
              <strong>${escapeHtml(workspace?.name || "Untitled")}</strong>
              <div class="list-item__actions">
                <button class="icon-button icon-button--danger" data-action="delete">Delete</button>
              </div>
            </div>
            <p class="muted">${escapeHtml(createdAt)} • ${escapeHtml(domain)}</p>
            <p class="muted">${escapeHtml(workspace?.description || "")}</p>
          `;
          const deleteButton = item.querySelector("button[data-action='delete']");
          if (deleteButton) {
            deleteButton.addEventListener("click", (event) => {
              event.stopPropagation();
              void actions.deleteWorkspace(workspace);
            });
          }
          item.addEventListener("click", () => {
            void actions.selectWorkspace(workspace);
          });
          el.workspaceList.appendChild(item);
        });
      } catch (err) {
        console.error(err);
      }
    },

    projects() {
      try {
        if (!el.projectList) return;
        el.projectList.innerHTML = "";

        if (!state.activeWorkspaceId) {
          el.projectList.innerHTML = '<div class="muted">Select a workspace first.</div>';
          return;
        }

        if (!Array.isArray(state.projects) || state.projects.length === 0) {
          el.projectList.innerHTML = '<div class="muted">No projects in this workspace.</div>';
          return;
        }

        state.projects.forEach((project) => {
          const item = document.createElement("div");
          item.className = "list-item";
          if (project?.id === state.activeProjectId) item.classList.add("list-item--active");

          const status = labelProjectStatus(project?.status);
          const owner = project?.owner || "Owner";
          const priority = labelPriority(project?.priority);

          item.innerHTML = `
            <div class="list-item__meta">
              <strong>${escapeHtml(project?.name || "Untitled")}</strong>
              <div class="list-item__actions">
                <button class="icon-button icon-button--danger" data-action="delete">Delete</button>
              </div>
            </div>
            <p class="muted">${escapeHtml(status)} • ${escapeHtml(priority)}</p>
            <p class="muted">Owner: ${escapeHtml(owner)}</p>
          `;
          const deleteButton = item.querySelector("button[data-action='delete']");
          if (deleteButton) {
            deleteButton.addEventListener("click", (event) => {
              event.stopPropagation();
              void actions.deleteProject(project);
            });
          }
          item.addEventListener("click", () => {
            void actions.selectProject(project);
          });
          el.projectList.appendChild(item);
        });
      } catch (err) {
        console.error(err);
      }
    },

    activeProject() {
      try {
        if (!el.activeProjectName || !el.activeProjectMeta) return;

        if (!state.activeProjectId) {
          el.activeProjectName.textContent = "Select a project";
          el.activeProjectMeta.textContent = "";
          if (el.projectTimeline) el.projectTimeline.textContent = "--";
          if (el.projectOwnerDisplay) el.projectOwnerDisplay.textContent = "Owner: --";
          if (el.projectProgressText) el.projectProgressText.textContent = "--";
          if (el.projectProgressBar) el.projectProgressBar.style.width = "0%";
          if (el.projectPriorityDisplay) el.projectPriorityDisplay.textContent = "--";
          if (el.projectStatusDisplay) el.projectStatusDisplay.textContent = "Status: --";
          if (el.markProjectCompletedButton) el.markProjectCompletedButton.disabled = true;
          return;
        }

        const project = (state.projects || []).find((p) => p?.id === state.activeProjectId);
        if (!project) return;

        el.activeProjectName.textContent = project.name || "Untitled";
        el.activeProjectMeta.textContent = `${labelProjectStatus(project.status)} • ${project.owner || "Owner"}`;

        if (el.projectTimeline) {
          el.projectTimeline.textContent = formatRange(project.startDate, project.endDate);
        }
        if (el.projectOwnerDisplay) {
          el.projectOwnerDisplay.textContent = `Owner: ${project.owner || "--"}`;
        }
        if (el.projectPriorityDisplay) {
          el.projectPriorityDisplay.textContent = labelPriority(project.priority);
        }
        if (el.projectStatusDisplay) {
          el.projectStatusDisplay.textContent = `Status: ${labelProjectStatus(project.status)}`;
        }
        if (el.projectProgressText || el.projectProgressBar) {
          const progress = typeof project.progress === "number" ? project.progress : calculateProgress();
          if (el.projectProgressText) el.projectProgressText.textContent = `${progress}%`;
          if (el.projectProgressBar) el.projectProgressBar.style.width = `${progress}%`;
        }

        if (el.markProjectCompletedButton) {
          const isCompleted = String(project.status || "").toLowerCase() === "completed";
          el.markProjectCompletedButton.disabled = isCompleted;
        }
      } catch (err) {
        console.error(err);
      }
    },

    taskDrafts() {
      try {
        if (!el.taskDraftList) return;
        el.taskDraftList.innerHTML = "";

        const drafts = Array.isArray(state.taskDrafts) ? state.taskDrafts : [];

        if (!state.activeProjectId) {
          el.taskDraftList.innerHTML = '<div class="muted">Select a project to generate drafts.</div>';
          if (el.commitTasksButton) el.commitTasksButton.disabled = true;
          return;
        }

        if (drafts.length === 0) {
          el.taskDraftList.innerHTML = '<div class="muted">No drafts yet.</div>';
          if (el.commitTasksButton) el.commitTasksButton.disabled = true;
          return;
        }

        drafts.forEach((draft) => {
          const card = document.createElement("div");
          card.className = "list-item";
          card.innerHTML = `
            <strong>${escapeHtml(draft?.title || "Draft task")}</strong>
            <p class="muted">Status: ${escapeHtml(labelTaskStatus(draft?.status))}</p>
          `;
          el.taskDraftList.appendChild(card);
        });

        if (el.commitTasksButton) el.commitTasksButton.disabled = false;
      } catch (err) {
        console.error(err);
      }
    },

    decisions() {
      try {
        if (!el.decisionList) return;
        el.decisionList.innerHTML = "";

        if (!state.activeProjectId) {
          el.decisionList.innerHTML = '<div class="muted">Select a project to ask a decision.</div>';
          return;
        }

        const decisions = Array.isArray(state.decisions) ? state.decisions : [];
        if (decisions.length === 0) {
          el.decisionList.innerHTML = '<div class="muted">No decisions yet.</div>';
          return;
        }

        decisions.slice(0, 5).forEach((decision) => {
          const card = document.createElement("div");
          card.className = "list-item";
          card.innerHTML = `
            <strong>${escapeHtml(decision?.question || "Decision")}</strong>
            <p class="muted">Answer: ${escapeHtml(decision?.answer || "--")}</p>
            <p class="muted">Confidence: ${escapeHtml(String(decision?.confidence ?? "--"))}</p>
          `;
          el.decisionList.appendChild(card);
        });
      } catch (err) {
        console.error(err);
      }
    },

    tasks() {
      try {
        // Never crash if any column is missing
        const tasks = Array.isArray(state.tasks) ? state.tasks : [];

        const normalized = tasks.map((task) => ({
          ...task,
          status: normalizeTaskStatus(task?.status),
        }));

        const planned = normalized.filter((t) => t?.status === "planned");
        const progress = normalized.filter((t) => t?.status === "in_progress");
        const review = normalized.filter((t) => t?.status === "review");
        const done = normalized.filter((t) => t?.status === "completed");
        const blocked = normalized.filter((t) => t?.status === "blocked");

        renderTaskColumn(el.plannedColumn, planned);
        renderTaskColumn(el.progressColumn, progress);
        renderTaskColumn(el.reviewColumn, review);
        renderTaskColumn(el.doneColumn, done);
        renderTaskColumn(el.blockedColumn, blocked);
      } catch (err) {
        console.error(err);
      }
    },

    insights() {
      try {
        if (!el.insightList || !el.insightCount) return;

        el.insightList.innerHTML = "";
        if (el.riskList) el.riskList.innerHTML = "";
        if (el.suggestionList) el.suggestionList.innerHTML = "";
        const insights = Array.isArray(state.insights) ? state.insights : [];
        el.insightCount.textContent = String(insights.length);

        if (insights.length === 0) {
          el.insightList.innerHTML = '<div class="muted">No insights yet.</div>';
          if (el.riskList) el.riskList.innerHTML = '<div class="muted">No risks detected.</div>';
          if (el.suggestionList)
            el.suggestionList.innerHTML = '<div class="muted">No suggestions yet.</div>';
          return;
        }

        insights.forEach((insight) => {
          const card = document.createElement("div");
          card.className = "list-item";
          card.innerHTML = `
            <strong>${escapeHtml(insight?.title || "Insight")}</strong>
            <p class="muted">${escapeHtml(insight?.summary || "")}</p>
            <span class="pill">${escapeHtml(insight?.severity || "")}</span>
          `;
          el.insightList.appendChild(card);
        });

        const risks = insights.filter(
          (insight) =>
            insight?.type === "risk" ||
            insight?.severity === "high" ||
            insight?.severity === "medium"
        );
        if (el.riskList) {
          if (risks.length === 0) {
            el.riskList.innerHTML = '<div class="muted">No risks detected.</div>';
          } else {
            risks.forEach((risk) => {
              const card = document.createElement("div");
              card.className = "list-item";
              card.innerHTML = `
                <strong>${escapeHtml(risk?.title || "Risk")}</strong>
                <p class="muted">${escapeHtml(risk?.summary || "")}</p>
              `;
              el.riskList.appendChild(card);
            });
          }
        }

        if (el.suggestionList) {
          const suggestions = insights.flatMap((insight) => insight?.recommendations || []);
          if (suggestions.length === 0) {
            el.suggestionList.innerHTML = '<div class="muted">No suggestions yet.</div>';
          } else {
            suggestions.slice(0, 6).forEach((text) => {
              const card = document.createElement("div");
              card.className = "list-item";
              card.innerHTML = `
                <strong>Suggested action</strong>
                <p class="muted">${escapeHtml(text)}</p>
              `;
              el.suggestionList.appendChild(card);
            });
          }
        }
      } catch (err) {
        console.error(err);
      }
    },

    health(health) {
      try {
        if (!el.healthPanel || !el.healthStatus || !el.healthScore || !el.healthSignals) return;

        if (!health) {
          el.healthStatus.textContent = "--";
          el.healthScore.textContent = "--";
          el.healthSignals.innerHTML = "";
          return;
        }

        el.healthStatus.textContent = health.status || "--";
        el.healthScore.textContent = String(health.riskScore ?? "--");
        el.healthSignals.innerHTML = "";

        const signals = Array.isArray(health.signals) ? health.signals : [];
        signals.forEach((signal) => {
          const li = document.createElement("li");
          li.textContent = String(signal);
          el.healthSignals.appendChild(li);
        });
      } catch (err) {
        console.error(err);
      }
    },

    reports() {
      try {
        if (!el.reportList || !el.reportCount) return;
        el.reportList.innerHTML = "";

        const reports = Array.isArray(state.reports) ? state.reports : [];
        const filtered = state.activeWorkspaceId
          ? reports.filter((report) => report?.workspaceId === state.activeWorkspaceId)
          : reports;
        el.reportCount.textContent = String(filtered.length);

        if (filtered.length === 0) {
          el.reportList.innerHTML = '<div class="muted">No reports yet.</div>';
          return;
        }

        filtered.forEach((report) => {
          const item = document.createElement("div");
          item.className = "list-item";
          if (report?.id === state.activeReportId) item.classList.add("list-item--active");
          item.innerHTML = `
            <strong>${escapeHtml(report?.projectName || "Completion Report")}</strong>
            <p class="muted">${escapeHtml(formatDate(report?.createdAt))} • ${escapeHtml(
            formatDuration(report?.duration)
          )}</p>
          `;
          item.addEventListener("click", () => {
            void actions.selectReport(report);
          });
          el.reportList.appendChild(item);
        });
      } catch (err) {
        console.error(err);
      }
    },

    reportDetail() {
      try {
        if (!el.reportDetail || !el.reportStatus) return;
        const report = (state.reports || []).find((r) => r?.id === state.activeReportId);

        if (!report) {
          el.reportStatus.textContent = "--";
          el.reportDetail.innerHTML =
            '<p class="muted">Select a completed project report to view details.</p>';
          return;
        }

        el.reportStatus.textContent = "Ready";
        el.reportDetail.innerHTML = `
          <p class="muted">Workspace: ${escapeHtml(report?.workspaceName || "--")}</p>
          <p>${escapeHtml(report?.aiSummary || "")}</p>
          <div class="report__grid">
            <div>
              <p class="label">Duration</p>
              <p class="value">${escapeHtml(formatDuration(report?.duration))}</p>
            </div>
            <div>
              <p class="label">Tasks</p>
              <p class="value">${escapeHtml(String(report?.completedTasks ?? 0))} / ${escapeHtml(
          String(report?.totalTasks ?? 0)
        )}</p>
            </div>
            <div>
              <p class="label">Delayed</p>
              <p class="value">${escapeHtml(String(report?.delayedTasks ?? 0))}</p>
            </div>
            <div>
              <p class="label">Risk Score</p>
              <p class="value">${escapeHtml(String(report?.finalRiskScore ?? "--"))}</p>
            </div>
          </div>
          <p class="muted">Notes: ${escapeHtml(report?.completionNotes || "No notes yet.")}</p>
        `;
      } catch (err) {
        console.error(err);
      }
    },
  };

  function escapeHtml(str) {
    const s = String(str ?? "");
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function formatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString();
  }

  function formatRange(start, end) {
    const startLabel = formatDate(start);
    const endLabel = formatDate(end);
    if (startLabel === "--" && endLabel === "--") return "--";
    return `${startLabel} -> ${endLabel}`;
  }

  function formatDuration(days) {
    if (days === null || days === undefined || Number.isNaN(Number(days))) return "--";
    const value = Number(days);
    if (value < 0) return "--";
    return `${value} days`;
  }

  function normalizeTaskStatus(status) {
    const value = String(status || "").toLowerCase().replaceAll(" ", "_");
    const mapping = {
      todo: "planned",
      backlog: "planned",
      planned: "planned",
      in_progress: "in_progress",
      review: "review",
      done: "completed",
      completed: "completed",
      blocked: "blocked",
    };
    return mapping[value] || "planned";
  }

  function labelTaskStatus(status) {
    const value = String(status || "").toLowerCase().replaceAll(" ", "_");
    const mapping = {
      todo: "Planned",
      backlog: "Planned",
      planned: "Planned",
      in_progress: "In Progress",
      review: "Review",
      done: "Completed",
      completed: "Completed",
      blocked: "Blocked",
    };
    return mapping[value] || "Planned";
  }

  function labelProjectStatus(status) {
    const value = String(status || "").toLowerCase().replaceAll(" ", "_");
    const mapping = {
      planned: "Planned",
      active: "Active",
      blocked: "Blocked",
      completed: "Completed",
      on_hold: "On Hold",
      archived: "Archived",
    };
    return mapping[value] || "Planned";
  }

  function labelPriority(priority) {
    const value = String(priority || "").toLowerCase();
    const mapping = {
      low: "Low",
      medium: "Medium",
      high: "High",
      critical: "Critical",
    };
    return mapping[value] || "--";
  }

  function calculateProgress() {
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    if (tasks.length === 0) return 0;
    const completed = tasks.filter((task) => normalizeTaskStatus(task?.status) === "completed");
    return Math.round((completed.length / tasks.length) * 100);
  }

  function renderTaskColumn(column, tasks) {
    try {
      if (!column) return; // critical: avoid crashes if markup changes
      column.innerHTML = "";

      if (!Array.isArray(tasks) || tasks.length === 0) {
        column.innerHTML = '<div class="muted">No tasks.</div>';
        return;
      }

      tasks.forEach((task) => {
        const card = document.createElement("div");
        card.className = "list-item";
        const assignedTo = task?.assignedTo || task?.assignee || "Unassigned";
        const dueDate = formatDate(task?.dueDate);
        const priority = labelPriority(task?.priority);
        card.innerHTML = `
          <strong>${escapeHtml(task?.title || "Untitled task")}</strong>
          <p class="muted">${escapeHtml(assignedTo)}</p>
          <p class="muted">Due: ${escapeHtml(dueDate)} • ${escapeHtml(priority)}</p>
        `;

        const selector = document.createElement("select");
        const options = [
          { value: "planned", label: "Planned" },
          { value: "in_progress", label: "In Progress" },
          { value: "review", label: "Review" },
          { value: "completed", label: "Completed" },
          { value: "blocked", label: "Blocked" },
        ];

        options.forEach((optDef) => {
          const opt = document.createElement("option");
          opt.value = optDef.value;
          opt.textContent = optDef.label;
          opt.selected = normalizeTaskStatus(task?.status) === optDef.value;
          selector.appendChild(opt);
        });

        selector.addEventListener("change", (event) => {
          void (async () => {
            try {
              const nextStatus = event?.target?.value;
              if (!task?.id) {
                ui.toast("Task ID missing; cannot update status.");
                return;
              }
              await api.updateTask(task.id, { status: nextStatus });
              await actions.loadTasks();
              await actions.loadHealth();
            } catch (err) {
              ui.toast(normalizeErrorMessage(err));
            }
          })();
        });

        const actionsRow = document.createElement("div");
        actionsRow.className = "list-item__actions";

        const completeButton = document.createElement("button");
        completeButton.className = "icon-button";
        completeButton.textContent = "Complete";
        completeButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void (async () => {
            try {
              if (!task?.id) {
                ui.toast("Task ID missing; cannot update status.");
                return;
              }
              await api.updateTask(task.id, { status: "completed" });
              await actions.loadTasks();
              await actions.loadHealth();
            } catch (err) {
              ui.toast(normalizeErrorMessage(err));
            }
          })();
        });

        const deleteButton = document.createElement("button");
        deleteButton.className = "icon-button icon-button--danger";
        deleteButton.textContent = "Delete";
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          void actions.deleteTask(task);
        });

        actionsRow.appendChild(completeButton);
        actionsRow.appendChild(deleteButton);

        card.appendChild(selector);
        card.appendChild(actionsRow);
        column.appendChild(card);
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- Actions ----------
  const actions = {
    async initLanding() {
      try {
        if (el.apiStatus) ui.setApiStatusChecking(el.apiStatus);

        const status = el.apiStatus || document.getElementById("apiStatus");
        const demoTrigger = el.demoTrigger || document.getElementById("demoTrigger");

        const checkHealth = async () => {
          ui.setApiStatusChecking(status);
          try {
            const result = await api.health();
            state.apiOnline = true;
            ui.setApiBadge(status, true, result?.time || "");
          } catch (err) {
            state.apiOnline = false;
            ui.setApiBadge(status, false, normalizeErrorMessage(err));
          }
        };

        if (demoTrigger) {
          demoTrigger.addEventListener("click", () => {
            void (async () => {
              ui.setButtonLoading(demoTrigger, true, "Checking...");
              try {
                await checkHealth();
              } finally {
                ui.setButtonLoading(demoTrigger, false);
              }
            })();
          });
        }

        await checkHealth();
      } catch (err) {
        console.error(err);
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async initDashboard() {
      // Must never throw; keep UI interactive even if API offline
      try {
        // Show checking state immediately
        if (el.apiStatusInline) ui.setApiStatusChecking(el.apiStatusInline);

        // Bind events early so UI remains interactive even while loading
        bindEvents();

        // Try loading initial data
        await actions.loadWorkspaces();
        await actions.loadReports();

        // Auto-select first workspace if exists
        if (Array.isArray(state.workspaces) && state.workspaces[0]) {
          await actions.selectWorkspace(state.workspaces[0]);
        } else {
          // Ensure empty panels still render without crashing
          clearProjectPanels();
          render.workspaces();
          render.projects();
          render.activeProject();
          render.reports();
          render.reportDetail();
        }

        // Check API status last (doesn't block UI)
        void actions.updateApiStatusLoop();
      } catch (err) {
        console.error(err);
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async updateApiStatusOnce() {
      try {
        if (el.apiStatusInline) ui.setApiStatusChecking(el.apiStatusInline);
        const res = await api.health();
        state.apiOnline = true;
        ui.setApiBadge(el.apiStatusInline, true, res?.time || "");
      } catch (err) {
        state.apiOnline = false;
        ui.setApiBadge(el.apiStatusInline, false, "");
      }
    },

    async updateApiStatusLoop() {
      // Switch Checking -> Online/Offline and keep it updated.
      // Do not throw, do not block UI.
      try {
        await actions.updateApiStatusOnce();
        // Periodic refresh
        while (document && document.visibilityState !== "hidden") {
          await delay(30000);
          await actions.updateApiStatusOnce();
        }
      } catch (err) {
        // If loop fails, do nothing; UI stays interactive
        console.error(err);
      }
    },

    async loadWorkspaces() {
      try {
        const data = await api.listWorkspaces();
        state.workspaces = Array.isArray(data?.items) ? data.items : [];
        render.workspaces();
      } catch (err) {
        // Keep UI interactive; show empty state + toast
        state.workspaces = [];
        render.workspaces();
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async loadReports() {
      try {
        const data = await api.listReports();
        const reports = Array.isArray(data?.items) ? data.items : [];
        state.reports = reports;
        render.reports();
        render.reportDetail();
      } catch (err) {
        state.reports = [];
        render.reports();
        render.reportDetail();
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async selectWorkspace(workspace) {
      try {
        if (!workspace?.id) {
          ui.toast("Workspace ID missing.");
          return;
        }

        state.activeWorkspaceId = workspace.id;
        state.activeProjectId = null;
        state.activeReportId = null;
        state.projects = [];
        state.tasks = [];
        state.insights = [];
        state.taskDrafts = [];
        state.decisions = [];

        render.workspaces();
        render.projects();
        render.activeProject();
        clearProjectPanels();
        render.reports();
        render.reportDetail();
        render.taskDrafts();
        render.decisions();

        // Load projects for workspace
        try {
          const data = await api.listProjects(workspace.id);
          state.projects = Array.isArray(data?.items) ? data.items : [];
        } catch (err) {
          state.projects = [];
          ui.toast(normalizeErrorMessage(err));
        }

        render.projects();
        render.activeProject();
        await actions.loadReports();
      } catch (err) {
        console.error(err);
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async selectProject(project) {
      try {
        if (!project?.id) {
          ui.toast("Project ID missing.");
          return;
        }

        state.activeProjectId = project.id;
        state.taskDrafts = [];
        state.decisions = [];
        render.projects();
        render.activeProject();
        render.taskDrafts();
        render.decisions();

        // Load panels in parallel, each guarded
        await Promise.allSettled([
          actions.loadTasks(),
          actions.loadInsights(),
          actions.loadHealth(),
          actions.loadReports(),
        ]);
      } catch (err) {
        console.error(err);
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async loadTasks() {
      try {
        if (!state.activeProjectId) {
          state.tasks = [];
          render.tasks();
          return;
        }
        const data = await api.listTasks(state.activeProjectId);
        state.tasks = Array.isArray(data?.items) ? data.items : [];
        render.tasks();
        render.activeProject();
      } catch (err) {
        state.tasks = [];
        render.tasks();
        render.activeProject();
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async loadInsights() {
      try {
        if (!state.activeProjectId) {
          state.insights = [];
          render.insights();
          return;
        }
        const data = await api.listInsights(state.activeProjectId);
        state.insights = Array.isArray(data?.items) ? data.items : [];
        render.insights();
      } catch (err) {
        state.insights = [];
        render.insights();
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async loadHealth() {
      try {
        if (!state.activeProjectId) {
          render.health(null);
          return;
        }
        const data = await api.getHealth(state.activeProjectId);
        render.health(data?.health || null);
      } catch (err) {
        render.health(null);
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async createWorkspace() {
      try {
        const name = (el.workspaceName?.value || "").trim();
        const description = (el.workspaceDescription?.value || "").trim();
        const domain = (el.workspaceDomain?.value || "").trim();

        if (!name) {
          ui.toast("Workspace name is required");
          return;
        }

        await api.createWorkspace({
          name,
          description: description || null,
          domain: domain || null,
        });

        resetWorkspaceForm();

        await actions.loadWorkspaces();

        // Auto-select the newest workspace if present (best-effort)
        const newly = state.workspaces.find((w) => w?.name === name) || state.workspaces[0];
        if (newly) {
          await actions.selectWorkspace(newly);
        }
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async createProject() {
      try {
        if (!state.activeWorkspaceId) {
          ui.toast("Select a workspace first");
          return;
        }

        const name = (el.projectName?.value || "").trim();
        if (!name) {
          ui.toast("Project name is required");
          return;
        }

        const payload = {
          name,
          description: (el.projectDescription?.value || "").trim() || null,
          startDate: el.projectStartDate?.value || null,
          endDate: el.projectEndDate?.value || null,
          owner: (el.projectOwnerInput?.value || "").trim() || null,
          priority: el.projectPriority?.value || null,
          status: el.projectStatus?.value || "planned",
        };

        await api.createProject(state.activeWorkspaceId, payload);

        resetProjectForm();

        // Refresh projects list
        try {
          const data = await api.listProjects(state.activeWorkspaceId);
          state.projects = Array.isArray(data?.items) ? data.items : [];
        } catch (err) {
          state.projects = [];
          ui.toast(normalizeErrorMessage(err));
        }

        render.projects();

        // Best-effort auto-select new project
        const newly = state.projects.find((p) => p?.name === name);
        if (newly) {
          await actions.selectProject(newly);
        }
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async createTask() {
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }

        const title = (el.taskTitle?.value || "").trim();
        if (!title) {
          ui.toast("Task title is required");
          return;
        }

        const payload = {
          title,
          description: (el.taskDescription?.value || "").trim() || null,
          status: el.taskStatus?.value || "planned",
          priority: el.taskPriority?.value || null,
          dueDate: el.taskDueDate?.value || null,
          assignedTo: (el.taskAssignedTo?.value || "").trim() || null,
        };

        await api.createTask(state.activeProjectId, payload);

        resetTaskForm();

        await Promise.allSettled([actions.loadTasks(), actions.loadHealth()]);
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async deleteWorkspace(workspace) {
      try {
        if (!workspace?.id) {
          ui.toast("Workspace ID missing.");
          return;
        }
        if (!confirm("Delete this workspace? This cannot be undone.")) return;
        await api.deleteWorkspace(workspace.id);
        await actions.loadWorkspaces();
        state.activeWorkspaceId = null;
        state.activeProjectId = null;
        state.activeReportId = null;
        state.projects = [];
        state.tasks = [];
        state.insights = [];
        render.workspaces();
        render.projects();
        render.activeProject();
        clearProjectPanels();
        await actions.loadReports();
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async deleteProject(project) {
      try {
        if (!project?.id) {
          ui.toast("Project ID missing.");
          return;
        }
        if (!confirm("Delete this project? This cannot be undone.")) return;
        await api.deleteProject(project.id);
        await actions.selectWorkspace({ id: state.activeWorkspaceId });
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async deleteTask(task) {
      try {
        if (!task?.id) {
          ui.toast("Task ID missing.");
          return;
        }
        if (!confirm("Delete this task?")) return;
        await api.deleteTask(task.id);
        await Promise.allSettled([actions.loadTasks(), actions.loadHealth()]);
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async markProjectCompleted() {
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }
        const project = (state.projects || []).find((p) => p?.id === state.activeProjectId);
        if (!project) {
          ui.toast("Project not found");
          return;
        }
        if (String(project.status || "").toLowerCase() === "completed") {
          ui.toast("Project is already completed");
          return;
        }
        if (!confirm("Mark this project as Completed? This will generate a completion report.")) return;

        const res = await api.updateProject(state.activeProjectId, { status: "completed" });
        const updated = res?.project || res?.data?.project;
        if (updated) {
          state.projects = (state.projects || []).map((p) => (p?.id === updated.id ? updated : p));
        }
        render.projects();
        render.activeProject();

        await Promise.allSettled([actions.loadReports(), actions.loadHealth(), actions.loadInsights()]);
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async generateTaskDrafts() {
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }
        const prompt = (el.aiTaskPrompt?.value || "").trim();
        if (!prompt) {
          ui.toast("Prompt is required");
          return;
        }

        const data = await api.generateTaskDrafts(state.activeProjectId, { prompt });
        state.taskDrafts = Array.isArray(data?.generated) ? data.generated : [];
        render.taskDrafts();
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async commitTaskDrafts() {
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }
        const drafts = Array.isArray(state.taskDrafts) ? state.taskDrafts : [];
        const draftIds = drafts.map((d) => d?.id).filter(Boolean);
        if (draftIds.length === 0) {
          ui.toast("No drafts to commit");
          return;
        }

        await api.commitTaskDrafts(state.activeProjectId, { draftIds });
        state.taskDrafts = [];
        if (el.aiTaskPrompt) el.aiTaskPrompt.value = "";
        render.taskDrafts();

        await Promise.allSettled([actions.loadTasks(), actions.loadHealth(), actions.loadInsights()]);
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async askDecision() {
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }
        const question = (el.decisionQuestion?.value || "").trim();
        const optionsText = (el.decisionOptions?.value || "").trim();
        const options = optionsText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

        if (!question) {
          ui.toast("Decision question is required");
          return;
        }
        if (options.length === 0) {
          ui.toast("Add at least one option");
          return;
        }

        const data = await api.createDecision(state.activeProjectId, {
          question,
          context: { options },
        });

        const decision = data?.decision;
        if (decision) {
          state.decisions = [decision, ...(state.decisions || [])];
          render.decisions();
        }
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async selectReport(report) {
      try {
        if (!report?.id) {
          ui.toast("Report ID missing.");
          return;
        }
        state.activeReportId = report.id;
        render.reports();
        render.reportDetail();
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },

    async refreshInsights() {
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }
        await api.refreshInsights(state.activeProjectId);
        await actions.loadInsights();
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      }
    },
  };

  // ---------- Events / binding ----------
  function bindEvents() {
    const safe = (handler, label, button) => async () => {
      try {
        if (button) ui.setButtonLoading(button, true, label);
        await handler();
      } catch (err) {
        ui.toast(normalizeErrorMessage(err));
      } finally {
        if (button) ui.setButtonLoading(button, false);
      }
    };

    // Workspace buttons
    const createWorkspaceButton = document.getElementById("createWorkspaceButton");
    if (createWorkspaceButton) {
      createWorkspaceButton.addEventListener("click", () => {
        try {
          if (el.workspaceForm) el.workspaceForm.hidden = false;
        } catch {
          // ignore
        }
      });
    }

    const cancelWorkspaceButton = document.getElementById("cancelWorkspaceButton");
    if (cancelWorkspaceButton) {
      cancelWorkspaceButton.addEventListener("click", () => {
        resetWorkspaceForm();
      });
    }

    const saveWorkspaceButton = document.getElementById("saveWorkspaceButton");
    if (saveWorkspaceButton) {
      saveWorkspaceButton.addEventListener(
        "click",
        safe(actions.createWorkspace, "Saving...", saveWorkspaceButton)
      );
    }

    // Project buttons
    const createProjectButton = document.getElementById("createProjectButton");
    if (createProjectButton) {
      createProjectButton.addEventListener("click", () => {
        try {
          if (el.projectForm) el.projectForm.hidden = false;
        } catch {
          // ignore
        }
      });
    }

    const cancelProjectButton = document.getElementById("cancelProjectButton");
    if (cancelProjectButton) {
      cancelProjectButton.addEventListener("click", () => {
        resetProjectForm();
      });
    }

    const saveProjectButton = document.getElementById("saveProjectButton");
    if (saveProjectButton) {
      saveProjectButton.addEventListener(
        "click",
        safe(actions.createProject, "Saving...", saveProjectButton)
      );
    }

    // Task buttons
    const createTaskButton = document.getElementById("createTaskButton");
    if (createTaskButton) {
      createTaskButton.addEventListener("click", () => {
        try {
          if (el.taskForm) el.taskForm.hidden = false;
        } catch {
          // ignore
        }
      });
    }

    const cancelTaskButton = document.getElementById("cancelTaskButton");
    if (cancelTaskButton) {
      cancelTaskButton.addEventListener("click", () => {
        resetTaskForm();
      });
    }

    const saveTaskButton = document.getElementById("saveTaskButton");
    if (saveTaskButton) {
      saveTaskButton.addEventListener(
        "click",
        safe(actions.createTask, "Saving...", saveTaskButton)
      );
    }

    // Insights refresh
    const refreshInsightsButton = document.getElementById("refreshInsightsButton");
    if (refreshInsightsButton) {
      refreshInsightsButton.addEventListener(
        "click",
        safe(actions.refreshInsights, "Refreshing...", refreshInsightsButton)
      );
    }

    // Health load
    const loadHealthButton = document.getElementById("loadHealthButton");
    if (loadHealthButton) {
      loadHealthButton.addEventListener(
        "click",
        safe(actions.loadHealth, "Loading...", loadHealthButton)
      );
    }

    // Mark project completed
    const markProjectCompletedButton = document.getElementById("markProjectCompletedButton");
    if (markProjectCompletedButton) {
      markProjectCompletedButton.addEventListener(
        "click",
        safe(actions.markProjectCompleted, "Updating...", markProjectCompletedButton)
      );
    }

    // AI Task Generator
    const generateTasksButton = document.getElementById("generateTasksButton");
    if (generateTasksButton) {
      generateTasksButton.addEventListener(
        "click",
        safe(actions.generateTaskDrafts, "Generating...", generateTasksButton)
      );
    }

    const commitTasksButton = document.getElementById("commitTasksButton");
    if (commitTasksButton) {
      commitTasksButton.addEventListener(
        "click",
        safe(actions.commitTaskDrafts, "Committing...", commitTasksButton)
      );
    }

    // AI Decision Assistant
    const askDecisionButton = document.getElementById("askDecisionButton");
    if (askDecisionButton) {
      askDecisionButton.addEventListener(
        "click",
        safe(actions.askDecision, "Thinking...", askDecisionButton)
      );
    }
  }

  // ---------- Form resets / panel clears ----------
  function resetWorkspaceForm() {
    try {
      if (el.workspaceForm) el.workspaceForm.hidden = true;
      if (el.workspaceName) el.workspaceName.value = "";
      if (el.workspaceDescription) el.workspaceDescription.value = "";
      if (el.workspaceDomain) el.workspaceDomain.value = "";
    } catch {
      // ignore
    }
  }

  function resetProjectForm() {
    try {
      if (el.projectForm) el.projectForm.hidden = true;
      if (el.projectName) el.projectName.value = "";
      if (el.projectDescription) el.projectDescription.value = "";
      if (el.projectStartDate) el.projectStartDate.value = "";
      if (el.projectEndDate) el.projectEndDate.value = "";
      if (el.projectOwnerInput) el.projectOwnerInput.value = "";
      if (el.projectPriority) el.projectPriority.value = "";
      if (el.projectStatus) el.projectStatus.value = "planned";
    } catch {
      // ignore
    }
  }

  function resetTaskForm() {
    try {
      if (el.taskForm) el.taskForm.hidden = true;
      if (el.taskTitle) el.taskTitle.value = "";
      if (el.taskDescription) el.taskDescription.value = "";
      if (el.taskStatus) el.taskStatus.value = "planned";
      if (el.taskPriority) el.taskPriority.value = "";
      if (el.taskDueDate) el.taskDueDate.value = "";
      if (el.taskAssignedTo) el.taskAssignedTo.value = "";
    } catch {
      // ignore
    }
  }

  function clearProjectPanels() {
    try {
      state.tasks = [];
      state.insights = [];
      state.taskDrafts = [];
      state.decisions = [];
      render.tasks();
      render.insights();
      render.health(null);
      render.taskDrafts();
      render.decisions();
    } catch {
      // ignore
    }
  }

  // ---------- Init ----------
  function init() {
    try {
      cacheElements();

      const isDashboard = !!document.querySelector(".page--dashboard");
      const isLanding = !!document.querySelector(".page--landing");

      if (isLanding) {
        // Landing page: do not block UI
        void actions.initLanding();
      }

      if (isDashboard) {
        // Dashboard: async init guarded
        void actions.initDashboard();
      }
    } catch (err) {
      console.error(err);
      try {
        ui.toast(normalizeErrorMessage(err));
      } catch {
        // ignore
      }
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();