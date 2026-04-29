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
    activeWorkspaceId: null,
    activeProjectId: null,
    apiOnline: null, // null | true | false
  };

  // ---------- Element cache ----------
  const el = {};

  function cacheElements() {
    // Lists / panels
    el.workspaceList = document.getElementById("workspaceList");
    el.projectList = document.getElementById("projectList");

    el.activeProjectName = document.getElementById("activeProjectName");
    el.activeProjectMeta = document.getElementById("activeProjectMeta");

    el.todoColumn = document.getElementById("todoColumn");
    el.progressColumn = document.getElementById("progressColumn");
    el.doneColumn = document.getElementById("doneColumn");

    el.insightList = document.getElementById("insightList");
    el.insightCount = document.getElementById("insightCount");

    el.healthPanel = document.getElementById("healthPanel");
    el.healthStatus = document.getElementById("healthStatus");
    el.healthScore = document.getElementById("healthScore");
    el.healthSignals = document.getElementById("healthSignals");

    // Forms
    el.workspaceForm = document.getElementById("workspaceForm");
    el.workspaceName = document.getElementById("workspaceName");
    el.workspaceDescription = document.getElementById("workspaceDescription");

    el.projectForm = document.getElementById("projectForm");
    el.projectName = document.getElementById("projectName");
    el.projectDescription = document.getElementById("projectDescription");
    el.projectStartDate = document.getElementById("projectStartDate");
    el.projectEndDate = document.getElementById("projectEndDate");
    el.projectOwner = document.getElementById("projectOwner");

    el.taskForm = document.getElementById("taskForm");
    el.taskTitle = document.getElementById("taskTitle");
    el.taskDescription = document.getElementById("taskDescription");
    el.taskStatus = document.getElementById("taskStatus");
    el.taskPriority = document.getElementById("taskPriority");
    el.taskDueDate = document.getElementById("taskDueDate");

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

    listProjects: (workspaceId) => api.request(`/workspaces/${workspaceId}/projects`),
    createProject: (workspaceId, data) =>
      api.request(`/workspaces/${workspaceId}/projects`, {
        method: "POST",
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

    listInsights: (projectId) => api.request(`/projects/${projectId}/insights`),
    refreshInsights: (projectId) =>
      api.request(`/projects/${projectId}/insights/refresh`, {
        method: "POST",
        body: JSON.stringify({ scope: "project" }),
      }),

    getHealth: (projectId) => api.request(`/projects/${projectId}/health`),
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
          item.innerHTML = `
            <strong>${escapeHtml(workspace?.name || "Untitled")}</strong>
            <p class="muted">${escapeHtml(workspace?.description || "")}</p>
          `;
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

          const status = project?.status || "unknown";
          const owner = project?.owner || "Owner";

          item.innerHTML = `
            <strong>${escapeHtml(project?.name || "Untitled")}</strong>
            <p class="muted">${escapeHtml(status)} • ${escapeHtml(owner)}</p>
          `;
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
          return;
        }

        const project = (state.projects || []).find((p) => p?.id === state.activeProjectId);
        if (!project) return;

        el.activeProjectName.textContent = project.name || "Untitled";
        el.activeProjectMeta.textContent = `${project.status || "unknown"} • ${project.owner || "Owner"}`;
      } catch (err) {
        console.error(err);
      }
    },

    tasks() {
      try {
        // Never crash if any column is missing
        const tasks = Array.isArray(state.tasks) ? state.tasks : [];

        const todo = tasks.filter((t) => ["todo", "backlog", "blocked"].includes(t?.status));
        const progress = tasks.filter((t) => t?.status === "in_progress");
        const done = tasks.filter((t) => t?.status === "done");

        renderTaskColumn(el.todoColumn, todo);
        renderTaskColumn(el.progressColumn, progress);
        renderTaskColumn(el.doneColumn, done);
      } catch (err) {
        console.error(err);
      }
    },

    insights() {
      try {
        if (!el.insightList || !el.insightCount) return;

        el.insightList.innerHTML = "";
        const insights = Array.isArray(state.insights) ? state.insights : [];
        el.insightCount.textContent = String(insights.length);

        if (insights.length === 0) {
          el.insightList.innerHTML = '<div class="muted">No insights yet.</div>';
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
        card.innerHTML = `
          <strong>${escapeHtml(task?.title || "Untitled task")}</strong>
          <p class="muted">${escapeHtml(task?.assignee || "Unassigned")}</p>
        `;

        const selector = document.createElement("select");
        const options = [
          { value: "todo", label: "To Do" },
          { value: "in_progress", label: "In Progress" },
          { value: "done", label: "Done" },
          { value: "blocked", label: "Blocked" },
          { value: "backlog", label: "Backlog" },
        ];

        options.forEach((optDef) => {
          const opt = document.createElement("option");
          opt.value = optDef.value;
          opt.textContent = optDef.label;
          opt.selected = task?.status === optDef.value;
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

        card.appendChild(selector);
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

        // Auto-select first workspace if exists
        if (Array.isArray(state.workspaces) && state.workspaces[0]) {
          await actions.selectWorkspace(state.workspaces[0]);
        } else {
          // Ensure empty panels still render without crashing
          clearProjectPanels();
          render.workspaces();
          render.projects();
          render.activeProject();
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

    async selectWorkspace(workspace) {
      try {
        if (!workspace?.id) {
          ui.toast("Workspace ID missing.");
          return;
        }

        state.activeWorkspaceId = workspace.id;
        state.activeProjectId = null;
        state.projects = [];
        state.tasks = [];
        state.insights = [];

        render.workspaces();
        render.projects();
        render.activeProject();
        clearProjectPanels();

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
        render.projects();
        render.activeProject();

        // Load panels in parallel, each guarded
        await Promise.allSettled([
          actions.loadTasks(),
          actions.loadInsights(),
          actions.loadHealth(),
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
      } catch (err) {
        state.tasks = [];
        render.tasks();
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

        if (!name) {
          ui.toast("Workspace name is required");
          return;
        }

        await api.createWorkspace({
          name,
          description: description || null,
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
          owner: (el.projectOwner?.value || "").trim() || null,
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
          status: el.taskStatus?.value || "todo",
          priority: el.taskPriority?.value || null,
          dueDate: el.taskDueDate?.value || null,
        };

        await api.createTask(state.activeProjectId, payload);

        resetTaskForm();

        await Promise.allSettled([actions.loadTasks(), actions.loadHealth()]);
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
  }

  // ---------- Form resets / panel clears ----------
  function resetWorkspaceForm() {
    try {
      if (el.workspaceForm) el.workspaceForm.hidden = true;
      if (el.workspaceName) el.workspaceName.value = "";
      if (el.workspaceDescription) el.workspaceDescription.value = "";
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
      if (el.projectOwner) el.projectOwner.value = "";
    } catch {
      // ignore
    }
  }

  function resetTaskForm() {
    try {
      if (el.taskForm) el.taskForm.hidden = true;
      if (el.taskTitle) el.taskTitle.value = "";
      if (el.taskDescription) el.taskDescription.value = "";
      if (el.taskStatus) el.taskStatus.value = "todo";
      if (el.taskPriority) el.taskPriority.value = "";
      if (el.taskDueDate) el.taskDueDate.value = "";
    } catch {
      // ignore
    }
  }

  function clearProjectPanels() {
    try {
      state.tasks = [];
      state.insights = [];
      render.tasks();
      render.insights();
      render.health(null);
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