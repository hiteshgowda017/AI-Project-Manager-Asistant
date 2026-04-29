```javascript
const App = (() => {
  const config = {
    apiBaseUrl: "https://ai-pm-backend-0lfc.onrender.com/api/v1",
  };

  const state = {
    workspaces: [],
    projects: [],
    tasks: [],
    insights: [],
    decisions: [],
    reports: [],
    taskDrafts: [],
    activeWorkspaceId: null,
    activeProjectId: null,
  };

  const elements = {};

  const api = {
    async request(path, options = {}) {
      const response = await fetch(`${config.apiBaseUrl}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...options,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        const message = payload.error?.message || "Request failed";
        throw new Error(message);
      }

      if (response.status === 204) return null;
      return response.json();
    },

    health: () => api.request("/health"),
    listWorkspaces: (page = 1) => api.request(`/workspaces?page=${page}`),
    createWorkspace: (data) =>
      api.request("/workspaces", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    listProjects: (workspaceId) =>
      api.request(`/workspaces/${workspaceId}/projects`),
    createProject: (workspaceId, data) =>
      api.request(`/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    getProject: (projectId) => api.request(`/projects/${projectId}`),
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
    listInsights: (projectId) =>
      api.request(`/projects/${projectId}/insights`),
    refreshInsights: (projectId) =>
      api.request(`/projects/${projectId}/insights/refresh`, {
        method: "POST",
        body: JSON.stringify({ scope: "project" }),
      }),
    getHealth: (projectId) => api.request(`/projects/${projectId}/health`),
    generateTasks: (projectId, data) =>
      api.request(`/projects/${projectId}/ai/tasks`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    commitTasks: (projectId, data) =>
      api.request(`/projects/${projectId}/ai/tasks/commit`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    createDecision: (projectId, data) =>
      api.request(`/projects/${projectId}/ai/decisions`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    listDecisions: (projectId) =>
      api.request(`/projects/${projectId}/decisions`),
  };

  const ui = {
    toast(message) {
      if (!elements.toast) return;
      elements.toast.textContent = message;
      elements.toast.style.display = "block";
      setTimeout(() => {
        elements.toast.style.display = "none";
      }, 2800);
    },

    setButtonLoading(button, isLoading, label) {
      if (!button) return;

      if (isLoading) {
        button.dataset.originalText = button.textContent;
        button.textContent = label || "Loading...";
        button.disabled = true;
      } else {
        button.textContent = button.dataset.originalText || button.textContent;
        button.disabled = false;
      }
    },
  };

  const render = {
    workspaces() {
      if (!elements.workspaceList) return;
      elements.workspaceList.innerHTML = "";

      if (state.workspaces.length === 0) {
        elements.workspaceList.innerHTML =
          '<div class="muted">No workspaces yet.</div>';
        return;
      }

      state.workspaces.forEach((workspace) => {
        const item = document.createElement("div");
        item.className = "list-item";

        if (workspace.id === state.activeWorkspaceId) {
          item.classList.add("list-item--active");
        }

        item.innerHTML = `
          <strong>${workspace.name}</strong>
          <p class="muted">${workspace.description || ""}</p>
        `;

        item.addEventListener("click", () => actions.selectWorkspace(workspace));
        elements.workspaceList.appendChild(item);
      });
    },

    projects() {
      if (!elements.projectList) return;
      elements.projectList.innerHTML = "";

      if (!state.activeWorkspaceId) {
        elements.projectList.innerHTML =
          '<div class="muted">Select a workspace first.</div>';
        return;
      }

      if (state.projects.length === 0) {
        elements.projectList.innerHTML =
          '<div class="muted">No projects in this workspace.</div>';
        return;
      }

      state.projects.forEach((project) => {
        const item = document.createElement("div");
        item.className = "list-item";

        if (project.id === state.activeProjectId) {
          item.classList.add("list-item--active");
        }

        item.innerHTML = `
          <strong>${project.name}</strong>
          <p class="muted">${project.status} • ${project.owner || "Owner"}</p>
        `;

        item.addEventListener("click", () => actions.selectProject(project));
        elements.projectList.appendChild(item);
      });
    },

    activeProject() {
      if (!elements.activeProjectName) return;

      if (!state.activeProjectId) {
        elements.activeProjectName.textContent = "Select a project";
        elements.activeProjectMeta.textContent = "";
        return;
      }

      const project = state.projects.find(
        (item) => item.id === state.activeProjectId
      );

      if (!project) return;

      elements.activeProjectName.textContent = project.name;
      elements.activeProjectMeta.textContent =
        `${project.status} • ${project.owner || "Owner"}`;
    },

    tasks() {
      if (!elements.todoColumn) return;

      const todo = state.tasks.filter((task) => task.status === "todo");
      const progress = state.tasks.filter(
        (task) => task.status === "in_progress"
      );
      const done = state.tasks.filter((task) => task.status === "done");

      renderTaskColumn(elements.todoColumn, todo);
      renderTaskColumn(elements.progressColumn, progress);
      renderTaskColumn(elements.doneColumn, done);
    },

    insights() {
      if (!elements.insightList) return;
      elements.insightList.innerHTML = "";
      elements.insightCount.textContent = state.insights.length;

      if (state.insights.length === 0) {
        elements.insightList.innerHTML =
          '<div class="muted">No insights yet.</div>';
        return;
      }

      state.insights.forEach((insight) => {
        const card = document.createElement("div");
        card.className = "list-item";
        card.innerHTML = `
          <strong>${insight.title}</strong>
          <p class="muted">${insight.summary}</p>
          <span class="pill">${insight.severity}</span>
        `;
        elements.insightList.appendChild(card);
      });
    },

    decisions() {
      if (!elements.decisionList) return;
      elements.decisionList.innerHTML = "";

      if (state.decisions.length === 0) {
        elements.decisionList.innerHTML =
          '<div class="muted">No decisions captured.</div>';
        return;
      }

      state.decisions.forEach((decision) => {
        const card = document.createElement("div");
        card.className = "list-item";
        card.innerHTML = `
          <strong>${decision.question}</strong>
          <p class="muted">${decision.answer}</p>
          <span class="pill">Confidence ${decision.confidence}</span>
        `;
        elements.decisionList.appendChild(card);
      });
    },

    health(health) {
      if (!elements.healthPanel) return;

      if (!health) {
        elements.healthStatus.textContent = "--";
        elements.healthScore.textContent = "--";
        elements.healthSignals.innerHTML = "";
        return;
      }

      elements.healthStatus.textContent = health.status;
      elements.healthScore.textContent = health.riskScore;
      elements.healthSignals.innerHTML = "";

      health.signals.forEach((signal) => {
        const li = document.createElement("li");
        li.textContent = signal;
        elements.healthSignals.appendChild(li);
      });
    },

    taskDrafts() {
      if (!elements.taskDraftList) return;
      elements.taskDraftList.innerHTML = "";
      elements.commitTasksButton.disabled = state.taskDrafts.length === 0;

      if (state.taskDrafts.length === 0) {
        elements.taskDraftList.innerHTML =
          '<div class="muted">No drafts generated.</div>';
        return;
      }

      state.taskDrafts.forEach((draft) => {
        const card = document.createElement("div");
        card.className = "list-item";
        card.innerHTML = `
          <strong>${draft.title}</strong>
          <p class="muted">Status: ${draft.status}</p>
        `;
        elements.taskDraftList.appendChild(card);
      });
    },
  };

  function renderTaskColumn(column, tasks) {
    column.innerHTML = "";

    if (tasks.length === 0) {
      column.innerHTML = '<div class="muted">No tasks.</div>';
      return;
    }

    tasks.forEach((task) => {
      const card = document.createElement("div");
      card.className = "list-item";
      card.innerHTML = `
        <strong>${task.title}</strong>
        <p class="muted">${task.assignee || "Unassigned"}</p>
      `;

      const selector = document.createElement("select");

      [
        { value: "todo", label: "To Do" },
        { value: "in_progress", label: "In Progress" },
        { value: "done", label: "Done" },
        { value: "blocked", label: "Blocked" },
        { value: "backlog", label: "Backlog" },
      ].forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        if (task.status === option.value) opt.selected = true;
        selector.appendChild(opt);
      });

      selector.addEventListener("change", async (event) => {
        try {
          await api.updateTask(task.id, { status: event.target.value });
          await actions.loadTasks();
        } catch (error) {
          ui.toast(error.message);
        }
      });

      card.appendChild(selector);
      column.appendChild(card);
    });
  }

  const actions = {
    async initLanding() {
      const status = document.getElementById("apiStatus");
      const demoTrigger = document.getElementById("demoTrigger");
      if (!status || !demoTrigger) return;

      demoTrigger.addEventListener("click", async () => {
        try {
          ui.setButtonLoading(demoTrigger, true, "Checking...");
          const result = await api.health();
          status.innerHTML = `
            <span class="status-pill">API: Online</span>
            <span class="status-text">${result.time}</span>
          `;
        } catch (error) {
          status.innerHTML = `
            <span class="status-pill">API: Offline</span>
            <span class="status-text">${error.message}</span>
          `;
        } finally {
          ui.setButtonLoading(demoTrigger, false);
        }
      });
    },

    async initDashboard() {
      cacheElements();
      bindEvents();
      await actions.loadWorkspaces();

      if (state.workspaces[0]) {
        await actions.selectWorkspace(state.workspaces[0]);
      }

      await actions.updateApiStatus();
    },

    async updateApiStatus() {
      if (!elements.apiStatusInline) return;

      try {
        await api.health();
        elements.apiStatusInline.textContent = "API: Online";
        elements.apiStatusInline.style.color = "#15803d";
      } catch (error) {
        elements.apiStatusInline.textContent = "API: Offline";
        elements.apiStatusInline.style.color = "#dc2626";
      }
    },

    async loadWorkspaces() {
      const data = await api.listWorkspaces();
      state.workspaces = data.items || [];
      render.workspaces();
    },

    async selectWorkspace(workspace) {
      state.activeWorkspaceId = workspace.id;
      render.workspaces();

      const data = await api.listProjects(workspace.id);
      state.projects = data.items || [];
      state.activeProjectId = null;

      render.projects();
      render.activeProject();
      clearProjectPanels();
    },

    async selectProject(project) {
      state.activeProjectId = project.id;
      render.projects();
      render.activeProject();

      await Promise.all([
        actions.loadTasks(),
        actions.loadInsights(),
        actions.loadDecisions(),
        actions.loadHealth(),
      ]);
    },

    async loadTasks() {
      if (!state.activeProjectId) return;
      const data = await api.listTasks(state.activeProjectId);
      state.tasks = data.items || [];
      render.tasks();
    },

    async loadInsights() {
      if (!state.activeProjectId) return;
      const data = await api.listInsights(state.activeProjectId);
      state.insights = data.items || [];
      render.insights();
    },

    async loadDecisions() {
      if (!state.activeProjectId) return;
      const data = await api.listDecisions(state.activeProjectId);
      state.decisions = data.items || [];
      render.decisions();
    },

    async loadHealth() {
      if (!state.activeProjectId) return;
      const data = await api.getHealth(state.activeProjectId);
      render.health(data.health);
    },

    async createWorkspace() {
      const name = elements.workspaceName.value.trim();

      if (!name) {
        ui.toast("Workspace name is required");
        return;
      }

      const payload = {
        name,
        description: elements.workspaceDescription.value.trim() || null,
      };

      await api.createWorkspace(payload);
      elements.workspaceForm.hidden = true;
      elements.workspaceName.value = "";
      elements.workspaceDescription.value = "";
      await actions.loadWorkspaces();
    },

    async createProject() {
      if (!state.activeWorkspaceId) {
        ui.toast("Select a workspace first");
        return;
      }

      const name = elements.projectName.value.trim();

      if (!name) {
        ui.toast("Project name is required");
        return;
      }

      const payload = {
        name,
        description: elements.projectDescription.value.trim() || null,
        startDate: elements.projectStartDate.value || null,
        endDate: elements.projectEndDate.value || null,
        owner: elements.projectOwner.value.trim() || null,
      };

      await api.createProject(state.activeWorkspaceId, payload);

      elements.projectForm.hidden = true;
      elements.projectName.value = "";
      elements.projectDescription.value = "";
      elements.projectStartDate.value = "";
      elements.projectEndDate.value = "";
      elements.projectOwner.value = "";

      await actions.selectWorkspace(
        state.workspaces.find((ws) => ws.id === state.activeWorkspaceId)
      );
    },

    async createTask() {
      if (!state.activeProjectId) {
        ui.toast("Select a project first");
        return;
      }

      const title = elements.taskTitle.value.trim();

      if (!title) {
        ui.toast("Task title is required");
        return;
      }

      const payload = {
        title,
        description: elements.taskDescription.value.trim() || null,
        status: elements.taskStatus.value,
        priority: elements.taskPriority.value || null,
        dueDate: elements.taskDueDate.value || null,
      };

      await api.createTask(state.activeProjectId, payload);

      elements.taskForm.hidden = true;
      elements.taskTitle.value = "";
      elements.taskDescription.value = "";
      elements.taskStatus.value = "todo";
      elements.taskPriority.value = "";
      elements.taskDueDate.value = "";

      await actions.loadTasks();
      await actions.loadHealth();
    },

    async generateTaskDrafts() {
      if (!state.activeProjectId) {
        ui.toast("Select a project first");
        return;
      }

      const prompt = elements.aiTaskPrompt.value.trim();

      if (!prompt) {
        ui.toast("Add a prompt to generate drafts");
        return;
      }

      const data = await api.generateTasks(state.activeProjectId, { prompt });
      state.taskDrafts = data.generated || [];
      render.taskDrafts();
    },

    async commitTaskDrafts() {
      if (!state.activeProjectId || state.taskDrafts.length === 0) return;

      const draftIds = state.taskDrafts.map((draft) => draft.id);
      await api.commitTasks(state.activeProjectId, { draftIds });

      state.taskDrafts = [];
      render.taskDrafts();

      await actions.loadTasks();
      await actions.loadHealth();
    },

    async createDecision() {
      if (!state.activeProjectId) {
        ui.toast("Select a project first");
        return;
      }

      const question = elements.decisionQuestion.value.trim();
      const options = elements.decisionOptions.value
        .split("\n")
        .map((opt) => opt.trim())
        .filter(Boolean);

      if (!question || options.length === 0) {
        ui.toast("Provide a question and at least one option");
        return;
      }

      await api.createDecision(state.activeProjectId, {
        question,
        context: { options },
      });

      elements.decisionQuestion.value = "";
      elements.decisionOptions.value = "";
      await actions.loadDecisions();
    },
  };

  function cacheElements() {
    elements.workspaceList = document.getElementById("workspaceList");
    elements.workspaceForm = document.getElementById("workspaceForm");
    elements.workspaceName = document.getElementById("workspaceName");
    elements.workspaceDescription = document.getElementById("workspaceDescription");
    elements.projectList = document.getElementById("projectList");
    elements.projectForm = document.getElementById("projectForm");
    elements.projectName = document.getElementById("projectName");
    elements.projectDescription = document.getElementById("projectDescription");
    elements.projectStartDate = document.getElementById("projectStartDate");
    elements.projectEndDate = document.getElementById("projectEndDate");
    elements.projectOwner = document.getElementById("projectOwner");
    elements.activeProjectName = document.getElementById("activeProjectName");
    elements.activeProjectMeta = document.getElementById("activeProjectMeta");
    elements.todoColumn = document.getElementById("todoColumn");
    elements.progressColumn = document.getElementById("progressColumn");
    elements.doneColumn = document.getElementById("doneColumn");
    elements.insightList = document.getElementById("insightList");
    elements.insightCount = document.getElementById("insightCount");
    elements.healthPanel = document.getElementById("healthPanel");
    elements.healthStatus = document.getElementById("healthStatus");
    elements.healthScore = document.getElementById("healthScore");
    elements.healthSignals = document.getElementById("healthSignals");
    elements.taskForm = document.getElementById("taskForm");
    elements.taskTitle = document.getElementById("taskTitle");
    elements.taskDescription = document.getElementById("taskDescription");
    elements.taskStatus = document.getElementById("taskStatus");
    elements.taskPriority = document.getElementById("taskPriority");
    elements.taskDueDate = document.getElementById("taskDueDate");
    elements.aiTaskPrompt = document.getElementById("aiTaskPrompt");
    elements.taskDraftList = document.getElementById("taskDraftList");
    elements.commitTasksButton = document.getElementById("commitTasksButton");
    elements.decisionQuestion = document.getElementById("decisionQuestion");
    elements.decisionOptions = document.getElementById("decisionOptions");
    elements.decisionList = document.getElementById("decisionList");
    elements.toast = document.getElementById("toast");
    elements.apiStatusInline = document.getElementById("apiStatusInline");
  }

  function bindEvents() {
    document.getElementById("createWorkspaceButton")?.addEventListener("click", () => {
      elements.workspaceForm.hidden = false;
    });

    document.getElementById("cancelWorkspaceButton")?.addEventListener("click", () => {
      elements.workspaceForm.hidden = true;
    });

    document.getElementById("saveWorkspaceButton")?.addEventListener("click", async () => {
      const button = document.getElementById("saveWorkspaceButton");
      try {
        ui.setButtonLoading(button, true, "Saving...");
        await actions.createWorkspace();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("createProjectButton")?.addEventListener("click", () => {
      elements.projectForm.hidden = false;
    });

    document.getElementById("cancelProjectButton")?.addEventListener("click", () => {
      elements.projectForm.hidden = true;
    });

    document.getElementById("saveProjectButton")?.addEventListener("click", async () => {
      const button = document.getElementById("saveProjectButton");
      try {
        ui.setButtonLoading(button, true, "Saving...");
        await actions.createProject();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("createTaskButton")?.addEventListener("click", () => {
      elements.taskForm.hidden = false;
    });

    document.getElementById("cancelTaskButton")?.addEventListener("click", () => {
      elements.taskForm.hidden = true;
    });

    document.getElementById("saveTaskButton")?.addEventListener("click", async () => {
      const button = document.getElementById("saveTaskButton");
      try {
        ui.setButtonLoading(button, true, "Saving...");
        await actions.createTask();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("refreshInsightsButton")?.addEventListener("click", async () => {
      const button = document.getElementById("refreshInsightsButton");
      try {
        if (!state.activeProjectId) {
          ui.toast("Select a project first");
          return;
        }
        ui.setButtonLoading(button, true, "Refreshing...");
        await api.refreshInsights(state.activeProjectId);
        await actions.loadInsights();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("loadHealthButton")?.addEventListener("click", async () => {
      const button = document.getElementById("loadHealthButton");
      try {
        ui.setButtonLoading(button, true, "Loading...");
        await actions.loadHealth();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("generateTasksButton")?.addEventListener("click", async () => {
      const button = document.getElementById("generateTasksButton");
      try {
        ui.setButtonLoading(button, true, "Generating...");
        await actions.generateTaskDrafts();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("commitTasksButton")?.addEventListener("click", async () => {
      const button = document.getElementById("commitTasksButton");
      try {
        ui.setButtonLoading(button, true, "Committing...");
        await actions.commitTaskDrafts();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });

    document.getElementById("askDecisionButton")?.addEventListener("click", async () => {
      const button = document.getElementById("askDecisionButton");
      try {
        ui.setButtonLoading(button, true, "Analyzing...");
        await actions.createDecision();
      } catch (error) {
        ui.toast(error.message);
      } finally {
        ui.setButtonLoading(button, false);
      }
    });
  }

  function clearProjectPanels() {
    state.tasks = [];
    state.insights = [];
    state.decisions = [];
    state.taskDrafts = [];
    render.tasks();
    render.insights();
    render.decisions();
    render.taskDrafts();
    render.health(null);
  }

  return {
    init() {
      if (document.querySelector(".page--landing")) actions.initLanding();
      if (document.querySelector(".page--dashboard")) actions.initDashboard();
    },
  };
})();

document.addEventListener("DOMContentLoaded", () => {
  App.init();
});
```
