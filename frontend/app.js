(() => {
	const API_BASE_URL = "https://ai-pm-backend-0lfc.onrender.com/api/v1";

	const state = {
		workspaces: [],
		projects: [],
		tasks: [],
		insights: [],
		activeWorkspaceId: null,
		activeProjectId: null,
	};

	const el = {};

	const api = {
		async request(path, options = {}) {
			const response = await fetch(`${API_BASE_URL}${path}`, {
				headers: { "Content-Type": "application/json" },
				...options,
			});

			if (!response.ok) {
				const payload = await response.json().catch(() => ({}));
				const message = payload?.error?.message || "Request failed";
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
	};

	const ui = {
		toast(message) {
			if (!el.toast) return;
			el.toast.textContent = message;
			el.toast.style.display = "block";
			setTimeout(() => {
				el.toast.style.display = "none";
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
		setApiBadge(target, isOnline, timeText) {
			if (!target) return;
			if (target.id === "apiStatusInline") {
				const dot = target.querySelector(".dot");
				const label = target.querySelector("span:last-child");
				if (label) {
					label.textContent = isOnline ? "API: Online" : "API: Offline";
				}
				if (dot) {
					dot.style.background = isOnline ? "#0f7b6c" : "#d0586f";
				}
				return;
			}

			target.innerHTML = `
				<span class="status-pill">API: ${isOnline ? "Online" : "Offline"}</span>
				<span class="status-text">${timeText || ""}</span>
			`;
		},
	};

	const render = {
		workspaces() {
			if (!el.workspaceList) return;
			el.workspaceList.innerHTML = "";
			if (state.workspaces.length === 0) {
				el.workspaceList.innerHTML =
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
				el.workspaceList.appendChild(item);
			});
		},
		projects() {
			if (!el.projectList) return;
			el.projectList.innerHTML = "";
			if (!state.activeWorkspaceId) {
				el.projectList.innerHTML =
					'<div class="muted">Select a workspace first.</div>';
				return;
			}
			if (state.projects.length === 0) {
				el.projectList.innerHTML =
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
				el.projectList.appendChild(item);
			});
		},
		activeProject() {
			if (!el.activeProjectName) return;
			if (!state.activeProjectId) {
				el.activeProjectName.textContent = "Select a project";
				el.activeProjectMeta.textContent = "";
				return;
			}
			const project = state.projects.find(
				(item) => item.id === state.activeProjectId
			);
			if (!project) return;
			el.activeProjectName.textContent = project.name;
			el.activeProjectMeta.textContent =
				`${project.status} • ${project.owner || "Owner"}`;
		},
		tasks() {
			if (!el.todoColumn) return;
			const todo = state.tasks.filter((task) =>
				["todo", "backlog", "blocked"].includes(task.status)
			);
			const progress = state.tasks.filter(
				(task) => task.status === "in_progress"
			);
			const done = state.tasks.filter((task) => task.status === "done");
			renderTaskColumn(el.todoColumn, todo);
			renderTaskColumn(el.progressColumn, progress);
			renderTaskColumn(el.doneColumn, done);
		},
		insights() {
			if (!el.insightList) return;
			el.insightList.innerHTML = "";
			el.insightCount.textContent = state.insights.length;
			if (state.insights.length === 0) {
				el.insightList.innerHTML =
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
				el.insightList.appendChild(card);
			});
		},
		health(health) {
			if (!el.healthPanel) return;
			if (!health) {
				el.healthStatus.textContent = "--";
				el.healthScore.textContent = "--";
				el.healthSignals.innerHTML = "";
				return;
			}
			el.healthStatus.textContent = health.status;
			el.healthScore.textContent = health.riskScore;
			el.healthSignals.innerHTML = "";
			health.signals.forEach((signal) => {
				const li = document.createElement("li");
				li.textContent = signal;
				el.healthSignals.appendChild(li);
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
				opt.selected = task.status === option.value;
				selector.appendChild(opt);
			});
			selector.addEventListener("change", async (event) => {
				try {
					await api.updateTask(task.id, { status: event.target.value });
					await actions.loadTasks();
					await actions.loadHealth();
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
			if (!status) return;

			const checkHealth = async () => {
				try {
					const result = await api.health();
					ui.setApiBadge(status, true, result.time);
				} catch (error) {
					ui.setApiBadge(status, false, error.message);
				}
			};

			if (demoTrigger) {
				demoTrigger.addEventListener("click", async () => {
					try {
						ui.setButtonLoading(demoTrigger, true, "Checking...");
						await checkHealth();
					} finally {
						ui.setButtonLoading(demoTrigger, false);
					}
				});
			}

			await checkHealth();
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
			try {
				await api.health();
				ui.setApiBadge(el.apiStatusInline, true);
			} catch (error) {
				ui.setApiBadge(el.apiStatusInline, false);
			}
		},
		async loadWorkspaces() {
			try {
				const data = await api.listWorkspaces();
				state.workspaces = data.items || [];
				render.workspaces();
			} catch (error) {
				ui.toast(error.message);
			}
		},
		async selectWorkspace(workspace) {
			try {
				state.activeWorkspaceId = workspace.id;
				render.workspaces();
				const data = await api.listProjects(workspace.id);
				state.projects = data.items || [];
				state.activeProjectId = null;
				render.projects();
				render.activeProject();
				clearProjectPanels();
			} catch (error) {
				ui.toast(error.message);
			}
		},
		async selectProject(project) {
			try {
				state.activeProjectId = project.id;
				render.projects();
				render.activeProject();
				await Promise.all([
					actions.loadTasks(),
					actions.loadInsights(),
					actions.loadHealth(),
				]);
			} catch (error) {
				ui.toast(error.message);
			}
		},
		async loadTasks() {
			if (!state.activeProjectId) return;
			try {
				const data = await api.listTasks(state.activeProjectId);
				state.tasks = data.items || [];
				render.tasks();
			} catch (error) {
				ui.toast(error.message);
			}
		},
		async loadInsights() {
			if (!state.activeProjectId) return;
			try {
				const data = await api.listInsights(state.activeProjectId);
				state.insights = data.items || [];
				render.insights();
			} catch (error) {
				ui.toast(error.message);
			}
		},
		async loadHealth() {
			if (!state.activeProjectId) return;
			try {
				const data = await api.getHealth(state.activeProjectId);
				render.health(data.health);
			} catch (error) {
				ui.toast(error.message);
			}
		},
		async createWorkspace() {
			const name = el.workspaceName?.value.trim();
			if (!name) {
				ui.toast("Workspace name is required");
				return;
			}
			const payload = {
				name,
				description: el.workspaceDescription?.value.trim() || null,
			};
			await api.createWorkspace(payload);
			resetWorkspaceForm();
			await actions.loadWorkspaces();
		},
		async createProject() {
			if (!state.activeWorkspaceId) {
				ui.toast("Select a workspace first");
				return;
			}
			const name = el.projectName?.value.trim();
			if (!name) {
				ui.toast("Project name is required");
				return;
			}
			const payload = {
				name,
				description: el.projectDescription?.value.trim() || null,
				startDate: el.projectStartDate?.value || null,
				endDate: el.projectEndDate?.value || null,
				owner: el.projectOwner?.value.trim() || null,
			};
			await api.createProject(state.activeWorkspaceId, payload);
			resetProjectForm();
			const activeWorkspace = state.workspaces.find(
				(item) => item.id === state.activeWorkspaceId
			);
			if (activeWorkspace) {
				await actions.selectWorkspace(activeWorkspace);
			}
		},
		async createTask() {
			if (!state.activeProjectId) {
				ui.toast("Select a project first");
				return;
			}
			const title = el.taskTitle?.value.trim();
			if (!title) {
				ui.toast("Task title is required");
				return;
			}
			const payload = {
				title,
				description: el.taskDescription?.value.trim() || null,
				status: el.taskStatus?.value || "todo",
				priority: el.taskPriority?.value || null,
				dueDate: el.taskDueDate?.value || null,
			};
			await api.createTask(state.activeProjectId, payload);
			resetTaskForm();
			await actions.loadTasks();
			await actions.loadHealth();
		},
		async refreshInsights() {
			if (!state.activeProjectId) {
				ui.toast("Select a project first");
				return;
			}
			await api.refreshInsights(state.activeProjectId);
			await actions.loadInsights();
		},
	};

	function cacheElements() {
		el.workspaceList = document.getElementById("workspaceList");
		el.workspaceForm = document.getElementById("workspaceForm");
		el.workspaceName = document.getElementById("workspaceName");
		el.workspaceDescription = document.getElementById("workspaceDescription");
		el.projectList = document.getElementById("projectList");
		el.projectForm = document.getElementById("projectForm");
		el.projectName = document.getElementById("projectName");
		el.projectDescription = document.getElementById("projectDescription");
		el.projectStartDate = document.getElementById("projectStartDate");
		el.projectEndDate = document.getElementById("projectEndDate");
		el.projectOwner = document.getElementById("projectOwner");
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
		el.taskForm = document.getElementById("taskForm");
		el.taskTitle = document.getElementById("taskTitle");
		el.taskDescription = document.getElementById("taskDescription");
		el.taskStatus = document.getElementById("taskStatus");
		el.taskPriority = document.getElementById("taskPriority");
		el.taskDueDate = document.getElementById("taskDueDate");
		el.apiStatusInline = document.getElementById("apiStatusInline");
		el.toast = document.getElementById("toast");
	}

	function bindEvents() {
		const safe = (handler, label, button) => async () => {
			try {
				if (button) ui.setButtonLoading(button, true, label);
				await handler();
			} catch (error) {
				ui.toast(error.message);
			} finally {
				if (button) ui.setButtonLoading(button, false);
			}
		};

		const createWorkspaceButton = document.getElementById(
			"createWorkspaceButton"
		);
		if (createWorkspaceButton) {
			createWorkspaceButton.addEventListener("click", () => {
				if (el.workspaceForm) el.workspaceForm.hidden = false;
			});
		}

		const cancelWorkspaceButton = document.getElementById(
			"cancelWorkspaceButton"
		);
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

		const createProjectButton = document.getElementById("createProjectButton");
		if (createProjectButton) {
			createProjectButton.addEventListener("click", () => {
				if (el.projectForm) el.projectForm.hidden = false;
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

		const createTaskButton = document.getElementById("createTaskButton");
		if (createTaskButton) {
			createTaskButton.addEventListener("click", () => {
				if (el.taskForm) el.taskForm.hidden = false;
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

		const refreshInsightsButton = document.getElementById(
			"refreshInsightsButton"
		);
		if (refreshInsightsButton) {
			refreshInsightsButton.addEventListener(
				"click",
				safe(actions.refreshInsights, "Refreshing...", refreshInsightsButton)
			);
		}

		const loadHealthButton = document.getElementById("loadHealthButton");
		if (loadHealthButton) {
			loadHealthButton.addEventListener(
				"click",
				safe(actions.loadHealth, "Loading...", loadHealthButton)
			);
		}
	}

	function resetWorkspaceForm() {
		if (el.workspaceForm) el.workspaceForm.hidden = true;
		if (el.workspaceName) el.workspaceName.value = "";
		if (el.workspaceDescription) el.workspaceDescription.value = "";
	}

	function resetProjectForm() {
		if (el.projectForm) el.projectForm.hidden = true;
		if (el.projectName) el.projectName.value = "";
		if (el.projectDescription) el.projectDescription.value = "";
		if (el.projectStartDate) el.projectStartDate.value = "";
		if (el.projectEndDate) el.projectEndDate.value = "";
		if (el.projectOwner) el.projectOwner.value = "";
	}

	function resetTaskForm() {
		if (el.taskForm) el.taskForm.hidden = true;
		if (el.taskTitle) el.taskTitle.value = "";
		if (el.taskDescription) el.taskDescription.value = "";
		if (el.taskStatus) el.taskStatus.value = "todo";
		if (el.taskPriority) el.taskPriority.value = "";
		if (el.taskDueDate) el.taskDueDate.value = "";
	}

	function clearProjectPanels() {
		state.tasks = [];
		state.insights = [];
		render.tasks();
		render.insights();
		render.health(null);
	}

	function init() {
		const isDashboard = document.querySelector(".page--dashboard");
		const isLanding = document.querySelector(".page--landing");
		if (isLanding) {
			actions.initLanding();
		}
		if (isDashboard) {
			actions.initDashboard();
		}
	}

	document.addEventListener("DOMContentLoaded", init);
})();
