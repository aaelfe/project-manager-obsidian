import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, ItemView, WorkspaceLeaf } from 'obsidian';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import {
	DndContext,
	DragEndEvent,
	DragOverlay,
	DragStartEvent,
	PointerSensor,
	useSensor,
	useSensors,
	useDroppable,
} from '@dnd-kit/core';
import {
	SortableContext,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
	useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ProjectManagerSettings {
	supabaseUrl: string;
	supabaseKey: string;
	defaultProjectPath: string;
	enableRealtime: boolean;
}

const DEFAULT_SETTINGS: ProjectManagerSettings = {
	supabaseUrl: '',
	supabaseKey: '',
	defaultProjectPath: 'Projects',
	enableRealtime: true
};

export const VIEW_TYPE_KANBAN = "project-manager-kanban";

interface Project {
	id: string;
	name: string;
	description?: string;
	status: 'active' | 'completed' | 'archived';
	created_at: string;
	updated_at: string;
	markdown_file?: string;
	github_repo?: string;
}

interface Task {
	id: string;
	title: string;
	description?: string;
	status: 'todo' | 'in-progress' | 'done' | 'blocked' | 'cancelled';
	priority: 'low' | 'medium' | 'high' | 'urgent';
	project_id?: string;
	created_at: string;
	updated_at: string;
	due_date?: string;
	markdown_file?: string;
	github_repo?: string;
}

export class KanbanView extends ItemView {
	plugin: ProjectManagerPlugin;
	root: Root | null = null;
	selectedProjectId: string | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ProjectManagerPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_KANBAN;
	}

	getDisplayText() {
		if (this.selectedProjectId) {
			const project = this.plugin.projects.find(p => p.id === this.selectedProjectId);
			return project ? `Kanban: ${project.name}` : "Project Kanban";
		}
		return "Project Kanban";
	}

	setSelectedProject(projectId: string | null) {
		this.selectedProjectId = projectId;
		this.updateBoard();
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.createEl("div", { attr: { id: "kanban-root" } });
		
		const rootElement = container.querySelector("#kanban-root");
		if (rootElement) {
			this.root = createRoot(rootElement);
			this.updateBoard();
		}
	}

	updateBoard() {
		if (this.root) {
			// Force React re-render by creating new object references
			const projects = [...this.plugin.projects];
			const tasks = [...this.plugin.tasks];
			
			this.root.render(React.createElement(KanbanBoard, { 
				plugin: this.plugin,
				projects: projects,
				tasks: tasks,
				selectedProjectId: this.selectedProjectId,
				onProjectChange: (projectId: string | null) => this.setSelectedProject(projectId)
			}));
		}
	}

	async onClose() {
		if (this.root) {
			this.root.unmount();
		}
	}
}

export default class ProjectManagerPlugin extends Plugin {
	settings: ProjectManagerSettings;
	supabase: SupabaseClient | null = null;
	projects: Project[] = [];
	tasks: Task[] = [];
	realtimeChannel: RealtimeChannel | null = null;
	statusBarItem: HTMLElement | null = null;
	kanbanView: KanbanView | null = null;

	async onload() {
		await this.loadSettings();

		// Register the kanban view
		this.registerView(
			VIEW_TYPE_KANBAN,
			(leaf) => {
				this.kanbanView = new KanbanView(leaf, this);
				return this.kanbanView;
			}
		);

		// Add ribbon icon for project manager
		const ribbonIconEl = this.addRibbonIcon('folder-tree', 'Project Manager', (evt: MouseEvent) => {
			this.activateKanbanView();
		});
		ribbonIconEl.addClass('project-manager-ribbon-class');

		// Add status bar for active tasks
		this.statusBarItem = this.addStatusBarItem();
		this.updateStatusBar();

		// Commands for project management
		this.addCommand({
			id: 'create-new-project',
			name: 'Create New Project',
			callback: () => {
				new CreateProjectModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'create-new-task',
			name: 'Create New Task',
			callback: () => {
				new CreateTaskModal(this.app, this).open();
			}
		});

		this.addCommand({
			id: 'open-project-manager',
			name: 'Open Project Manager',
			callback: () => {
				this.activateKanbanView();
			}
		});

		this.addCommand({
			id: 'open-project-kanban',
			name: 'Open Project Kanban',
			callback: () => {
				this.openProjectKanbanSelector();
			}
		});
		// Editor command to link current note to project/task
		this.addCommand({
			id: 'link-note-to-project',
			name: 'Link Note to Project',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const file = view.file;
				if (file) {
					new LinkNoteModal(this.app, this, file).open();
				}
			}
		});
		// Command to refresh data
		this.addCommand({
			id: 'refresh-projects-tasks',
			name: 'Refresh Projects and Tasks',
			callback: () => {
				this.loadProjectsAndTasks();
				new Notice('Refreshed project data');
			}
		});

		// Command to reconnect to Supabase
		this.addCommand({
			id: 'reconnect-supabase',
			name: 'Reconnect to Supabase',
			callback: () => {
				this.initializeSupabase();
			}
		});

		// Settings tab
		this.addSettingTab(new ProjectManagerSettingTab(this.app, this));

		// Initialize Supabase connection
		this.initializeSupabase();
		
		// Load initial data
		this.loadProjectsAndTasks();

	}

	onunload() {
		if (this.realtimeChannel) {
			this.realtimeChannel.unsubscribe();
		}
	}


	initializeSupabase() {
		if (this.settings.supabaseUrl && this.settings.supabaseKey) {
			this.supabase = createClient(this.settings.supabaseUrl, this.settings.supabaseKey);
			
			if (this.settings.enableRealtime) {
				this.setupRealtimeSubscriptions();
			}
			
			new Notice('Connected to Supabase');
		} else {
			new Notice('Please configure Supabase settings');
		}
	}

	setupRealtimeSubscriptions() {
		if (!this.supabase) return;
		
		this.realtimeChannel = this.supabase
			.channel('project-manager-changes')
			.on('postgres_changes', 
				{ event: '*', schema: 'public', table: 'projects' },
				() => this.loadProjects()
			)
			.on('postgres_changes',
				{ event: '*', schema: 'public', table: 'tasks' },
				() => this.loadTasks()
			)
			.subscribe();
	}

	async loadProjectsAndTasks() {
		await Promise.all([this.loadProjects(), this.loadTasks()]);
		this.updateStatusBar();
	}

	async loadProjects() {
		if (!this.supabase) return;
		
		try {
			const { data, error } = await this.supabase
				.from('projects')
				.select('*')
				.order('updated_at', { ascending: false });
			
			if (error) throw error;
			this.projects = data || [];
			
			// Update kanban view if it's open
			if (this.kanbanView) {
				this.kanbanView.updateBoard();
			}
		} catch (error) {
			console.error('Failed to load projects:', error);
			new Notice('Failed to load projects');
		}
	}

	async loadTasks() {
		if (!this.supabase) return;
		
		try {
			const { data, error } = await this.supabase
				.from('tasks')
				.select('*')
				.order('updated_at', { ascending: false });
			
			if (error) throw error;
			this.tasks = data || [];
			
			// Update kanban view if it's open
			if (this.kanbanView) {
				this.kanbanView.updateBoard();
			}
		} catch (error) {
			console.error('Failed to load tasks:', error);
			new Notice('Failed to load tasks');
		}
	}

	async activateKanbanView() {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(VIEW_TYPE_KANBAN);

		if (leaves.length > 0) {
			// A kanban view is already open, focus the first one
			leaf = leaves[0];
		} else {
			// No kanban view is open, create one in the right sidebar
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: VIEW_TYPE_KANBAN, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	openProjectKanbanSelector() {
		new ProjectKanbanSelectorModal(this.app, this).open();
	}

	updateStatusBar() {
		if (!this.statusBarItem) return;
		const activeTasks = this.tasks.filter(task => task.status === 'in-progress').length;
		this.statusBarItem.setText(`Active tasks: ${activeTasks}`);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class ProjectManagerModal extends Modal {
	constructor(app: App, private plugin: ProjectManagerPlugin) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: 'Project Manager'});

		// Projects section
		const projectsDiv = contentEl.createDiv('projects-section');
		projectsDiv.createEl('h3', {text: 'Projects'});
		
		const projectsList = projectsDiv.createDiv('projects-list');
		this.plugin.projects.forEach(project => {
			const projectEl = projectsList.createDiv('project-item');
			projectEl.createEl('span', {text: project.name, cls: 'project-name'});
			projectEl.createEl('span', {text: project.status, cls: `status-${project.status}`});
		});

		// Tasks section
		const tasksDiv = contentEl.createDiv('tasks-section');
		tasksDiv.createEl('h3', {text: 'Recent Tasks'});
		
		const tasksList = tasksDiv.createDiv('tasks-list');
		this.plugin.tasks.slice(0, 10).forEach(task => {
			const taskEl = tasksList.createDiv('task-item');
			taskEl.createEl('span', {text: task.title, cls: 'task-title'});
			taskEl.createEl('span', {text: task.status, cls: `status-${task.status}`});
			taskEl.createEl('span', {text: task.priority, cls: `priority-${task.priority}`});
		});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class ProjectKanbanSelectorModal extends Modal {
	constructor(app: App, private plugin: ProjectManagerPlugin) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: 'Select Project for Kanban Board'});

		const form = contentEl.createDiv('project-selector-form');
		
		const projectsList = form.createDiv('projects-list');
		
		// Add "All Projects" option
		const allProjectsEl = projectsList.createDiv('project-selector-item');
		allProjectsEl.createEl('span', {text: 'All Projects', cls: 'project-name'});
		allProjectsEl.onclick = async () => {
			await this.plugin.activateKanbanView();
			if (this.plugin.kanbanView) {
				this.plugin.kanbanView.setSelectedProject(null);
			}
			this.close();
		};

		// Add individual projects
		this.plugin.projects.forEach(project => {
			const projectEl = projectsList.createDiv('project-selector-item');
			projectEl.createEl('span', {text: project.name, cls: 'project-name'});
			projectEl.createEl('span', {text: project.status, cls: `status-${project.status}`});
			if (project.description) {
				projectEl.createEl('p', {text: project.description, cls: 'project-description'});
			}
			
			projectEl.onclick = async () => {
				await this.plugin.activateKanbanView();
				if (this.plugin.kanbanView) {
					this.plugin.kanbanView.setSelectedProject(project.id);
				}
				this.close();
			};
		});

		const buttonDiv = form.createDiv('button-group');
		const cancelBtn = buttonDiv.createEl('button', {text: 'Cancel'});
		cancelBtn.onclick = () => this.close();
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class CreateProjectModal extends Modal {
	constructor(app: App, private plugin: ProjectManagerPlugin) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: 'Create New Project'});

		const form = contentEl.createDiv('project-form');
		
		const nameInput = form.createEl('input', {type: 'text', placeholder: 'Project name'});
		const descInput = form.createEl('textarea', {placeholder: 'Project description (optional)'});
		
		const buttonDiv = form.createDiv('button-group');
		const createBtn = buttonDiv.createEl('button', {text: 'Create Project'});
		const cancelBtn = buttonDiv.createEl('button', {text: 'Cancel'});

		createBtn.onclick = async () => {
			if (nameInput.value.trim()) {
				await this.createProject(nameInput.value.trim(), descInput.value.trim());
				this.close();
			}
		};

		cancelBtn.onclick = () => this.close();
	}

	async createProject(name: string, description: string) {
		if (!this.plugin.supabase) {
			new Notice('Not connected to Supabase');
			return;
		}
		
		try {
			const { error } = await this.plugin.supabase
				.from('projects')
				.insert([{ name, description }]);
			
			if (error) throw error;
			new Notice(`Project "${name}" created successfully`);
			
			// Real-time will update automatically, but refresh manually as backup
			if (!this.plugin.settings.enableRealtime) {
				this.plugin.loadProjects();
			}
		} catch (error) {
			console.error('Failed to create project:', error);
			new Notice('Failed to create project');
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class CreateTaskModal extends Modal {
	constructor(app: App, private plugin: ProjectManagerPlugin, private selectedProjectId?: string | null) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: 'Create New Task'});

		const form = contentEl.createDiv('task-form');
		
		const titleInput = form.createEl('input', {type: 'text', placeholder: 'Task title'});
		const descInput = form.createEl('textarea', {placeholder: 'Task description (optional)'});
		
		const prioritySelect = form.createEl('select');
		['low', 'medium', 'high', 'urgent'].forEach(priority => {
			const option = prioritySelect.createEl('option', {value: priority, text: priority});
			if (priority === 'medium') option.selected = true;
		});
		
		const projectSelect = form.createEl('select');
		projectSelect.createEl('option', {value: '', text: 'No project'});
		this.plugin.projects.forEach(project => {
			const option = projectSelect.createEl('option', {value: project.id, text: project.name});
			// Pre-select the current project if one is selected
			if (this.selectedProjectId && project.id === this.selectedProjectId) {
				option.selected = true;
			}
		});
		
		const buttonDiv = form.createDiv('button-group');
		const createBtn = buttonDiv.createEl('button', {text: 'Create Task'});
		const cancelBtn = buttonDiv.createEl('button', {text: 'Cancel'});

		createBtn.onclick = async () => {
			if (titleInput.value.trim()) {
				await this.createTask(
					titleInput.value.trim(),
					descInput.value.trim(),
					prioritySelect.value as 'low' | 'medium' | 'high' | 'urgent',
					projectSelect.value || undefined
				);
				this.close();
			}
		};

		cancelBtn.onclick = () => this.close();
	}

	async createTask(title: string, description: string, priority: 'low' | 'medium' | 'high' | 'urgent', projectId?: string) {
		if (!this.plugin.supabase) {
			new Notice('Not connected to Supabase');
			return;
		}
		
		try {
			const taskData: { title: string; description: string; priority: string; project_id?: string } = { title, description, priority };
			if (projectId) taskData.project_id = projectId;
			
			const { error } = await this.plugin.supabase
				.from('tasks')
				.insert([taskData]);
			
			if (error) throw error;
			new Notice(`Task "${title}" created successfully`);
			
			// Real-time will update automatically, but refresh manually as backup
			if (!this.plugin.settings.enableRealtime) {
				this.plugin.loadTasks();
			}
		} catch (error) {
			console.error('Failed to create task:', error);
			new Notice('Failed to create task');
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class TaskDetailModal extends Modal {
	constructor(app: App, private plugin: ProjectManagerPlugin, private task: Task) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: `Edit Task: ${this.task.title}`});

		const form = contentEl.createDiv('task-detail-form');
		
		const titleInput = form.createEl('input', {type: 'text', placeholder: 'Task title', value: this.task.title});
		titleInput.addClass('task-input');
		
		const descInput = form.createEl('textarea', {placeholder: 'Task description'});
		descInput.addClass('task-textarea');
		descInput.value = this.task.description || '';
		
		const prioritySelect = form.createEl('select');
		prioritySelect.addClass('task-select');
		['low', 'medium', 'high', 'urgent'].forEach(priority => {
			const option = prioritySelect.createEl('option', {value: priority, text: priority});
			if (priority === this.task.priority) option.selected = true;
		});
		
		const statusSelect = form.createEl('select');
		statusSelect.addClass('task-select');
		['todo', 'in-progress', 'done', 'blocked', 'cancelled'].forEach(status => {
			const option = statusSelect.createEl('option', {value: status, text: status});
			if (status === this.task.status) option.selected = true;
		});
		
		const projectSelect = form.createEl('select');
		projectSelect.addClass('task-select');
		projectSelect.createEl('option', {value: '', text: 'No project'});
		this.plugin.projects.forEach(project => {
			const option = projectSelect.createEl('option', {value: project.id, text: project.name});
			if (this.task.project_id === project.id) option.selected = true;
		});
		
		const dueDateInput = form.createEl('input', {type: 'datetime-local'});
		dueDateInput.addClass('task-input');
		if (this.task.due_date) {
			const date = new Date(this.task.due_date);
			dueDateInput.value = date.toISOString().slice(0, 16);
		}
		
		const markdownFileInput = form.createEl('input', {type: 'text', placeholder: 'Markdown file path'});
		markdownFileInput.addClass('task-input');
		markdownFileInput.value = this.task.markdown_file || '';
		
		const githubRepoInput = form.createEl('input', {type: 'text', placeholder: 'GitHub repo (owner/repo)'});
		githubRepoInput.addClass('task-input');
		githubRepoInput.value = this.task.github_repo || '';
		
		const metaDiv = form.createDiv('task-meta-info');
		metaDiv.createEl('p', {text: `Created: ${new Date(this.task.created_at).toLocaleString()}`});
		metaDiv.createEl('p', {text: `Updated: ${new Date(this.task.updated_at).toLocaleString()}`});
		
		const buttonDiv = form.createDiv('button-group');
		const saveBtn = buttonDiv.createEl('button', {text: 'Save Changes'});
		const deleteBtn = buttonDiv.createEl('button', {text: 'Delete Task', cls: 'mod-warning'});
		const cancelBtn = buttonDiv.createEl('button', {text: 'Cancel'});

		saveBtn.onclick = async () => {
			await this.updateTask({
				title: titleInput.value.trim(),
				description: descInput.value.trim() || undefined,
				priority: prioritySelect.value as 'low' | 'medium' | 'high' | 'urgent',
				status: statusSelect.value as 'todo' | 'in-progress' | 'done' | 'blocked' | 'cancelled',
				project_id: projectSelect.value || undefined,
				due_date: dueDateInput.value ? new Date(dueDateInput.value).toISOString() : undefined,
				markdown_file: markdownFileInput.value.trim() || undefined,
				github_repo: githubRepoInput.value.trim() || undefined
			});
			this.close();
		};

		deleteBtn.onclick = async () => {
			if (confirm(`Delete task "${this.task.title}"?`)) {
				await this.deleteTask();
				this.close();
			}
		};

		cancelBtn.onclick = () => this.close();
	}

	async updateTask(updates: Partial<Task>) {
		if (!this.plugin.supabase) {
			new Notice('Not connected to Supabase');
			return;
		}
		
		try {
			const { error } = await this.plugin.supabase
				.from('tasks')
				.update(updates)
				.eq('id', this.task.id);
			
			if (error) throw error;
			new Notice('Task updated successfully');
			
			if (!this.plugin.settings.enableRealtime) {
				this.plugin.loadTasks();
			}
		} catch (error) {
			console.error('Failed to update task:', error);
			new Notice('Failed to update task');
		}
	}

	async deleteTask() {
		if (!this.plugin.supabase) {
			new Notice('Not connected to Supabase');
			return;
		}
		
		try {
			const { error } = await this.plugin.supabase
				.from('tasks')
				.delete()
				.eq('id', this.task.id);
			
			if (error) throw error;
			new Notice('Task deleted successfully');
			
			if (!this.plugin.settings.enableRealtime) {
				this.plugin.loadTasks();
			}
		} catch (error) {
			console.error('Failed to delete task:', error);
			new Notice('Failed to delete task');
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class LinkNoteModal extends Modal {
	constructor(app: App, private plugin: ProjectManagerPlugin, private file: TFile) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();
		contentEl.createEl('h2', {text: `Link "${this.file.name}" to:`});

		const form = contentEl.createDiv('link-form');
		
		const projectSelect = form.createEl('select');
		projectSelect.createEl('option', {value: '', text: 'Select project'});
		this.plugin.projects.forEach(project => {
			projectSelect.createEl('option', {value: project.id, text: project.name});
		});
		
		const taskSelect = form.createEl('select');
		taskSelect.createEl('option', {value: '', text: 'Select task'});
		this.plugin.tasks.forEach(task => {
			taskSelect.createEl('option', {value: task.id, text: task.title});
		});
		
		const buttonDiv = form.createDiv('button-group');
		const linkBtn = buttonDiv.createEl('button', {text: 'Link Note'});
		const cancelBtn = buttonDiv.createEl('button', {text: 'Cancel'});

		linkBtn.onclick = async () => {
			await this.linkNote(projectSelect.value, taskSelect.value);
			this.close();
		};

		cancelBtn.onclick = () => this.close();
	}

	async linkNote(projectId: string, taskId: string) {
		if (!this.plugin.supabase) {
			new Notice('Not connected to Supabase');
			return;
		}
		
		const filePath = this.file.path;
		
		if (projectId) {
			try {
				const { error } = await this.plugin.supabase
					.from('projects')
					.update({ markdown_file: filePath })
					.eq('id', projectId);
				
				if (error) throw error;
				new Notice('Note linked to project');
			} catch (error) {
				console.error('Failed to link note to project:', error);
				new Notice('Failed to link note to project');
			}
		}
		
		if (taskId) {
			try {
				const { error } = await this.plugin.supabase
					.from('tasks')
					.update({ markdown_file: filePath })
					.eq('id', taskId);
				
				if (error) throw error;
				new Notice('Note linked to task');
			} catch (error) {
				console.error('Failed to link note to task:', error);
				new Notice('Failed to link note to task');
			}
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class ProjectManagerSettingTab extends PluginSettingTab {
	plugin: ProjectManagerPlugin;

	constructor(app: App, plugin: ProjectManagerPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Project Manager Settings'});

		new Setting(containerEl)
			.setName('Supabase URL')
			.setDesc('Your Supabase project URL')
			.addText(text => text
				.setPlaceholder('https://your-project.supabase.co')
				.setValue(this.plugin.settings.supabaseUrl)
				.onChange(async (value) => {
					this.plugin.settings.supabaseUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Supabase Anon Key')
			.setDesc('Your Supabase anonymous/public key')
			.addText(text => text
				.setPlaceholder('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')
				.setValue(this.plugin.settings.supabaseKey)
				.onChange(async (value) => {
					this.plugin.settings.supabaseKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable Real-time Updates')
			.setDesc('Automatically sync when data changes in Supabase')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableRealtime)
				.onChange(async (value) => {
					this.plugin.settings.enableRealtime = value;
					await this.plugin.saveSettings();
					// Reinitialize connection with new settings
					this.plugin.initializeSupabase();
				}));

		new Setting(containerEl)
			.setName('Default Project Path')
			.setDesc('Default folder path for project-related notes')
			.addText(text => text
				.setPlaceholder('Projects')
				.setValue(this.plugin.settings.defaultProjectPath)
				.onChange(async (value) => {
					this.plugin.settings.defaultProjectPath = value;
					await this.plugin.saveSettings();
				}));

		// Actions section
		containerEl.createEl('h3', {text: 'Actions'});
		
		const actionsDiv = containerEl.createDiv('connection-controls');
		
		const connectBtn = actionsDiv.createEl('button', {text: 'Connect to Supabase'});
		connectBtn.onclick = () => {
			this.plugin.initializeSupabase();
		};
		
		const refreshBtn = actionsDiv.createEl('button', {text: 'Refresh Data'});
		refreshBtn.onclick = () => {
			this.plugin.loadProjectsAndTasks();
			new Notice('Refreshed project data');
		};
	}
}

// React Components
interface KanbanBoardProps {
	plugin: ProjectManagerPlugin;
	projects: Project[];
	tasks: Task[];
	selectedProjectId: string | null;
	onProjectChange: (projectId: string | null) => void;
}

const KanbanBoard: React.FC<KanbanBoardProps> = ({ plugin, projects, tasks, selectedProjectId, onProjectChange }) => {
	const [filteredTasks, setFilteredTasks] = React.useState<Task[]>(tasks);
	const [activeId, setActiveId] = React.useState<string | null>(null);
	const [currentTasks, setCurrentTasks] = React.useState<Task[]>(tasks);
	const [currentProjects, setCurrentProjects] = React.useState<Project[]>(projects);

	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 3,
			},
		})
	);

	// Update local state when plugin data changes
	React.useEffect(() => {
		setCurrentTasks(tasks);
	}, [tasks]);

	React.useEffect(() => {
		setCurrentProjects(projects);
	}, [projects]);

	React.useEffect(() => {
		if (selectedProjectId === null) {
			// Show all tasks when no specific project is selected
			setFilteredTasks(currentTasks);
		} else {
			// Show only tasks for the selected project
			setFilteredTasks(currentTasks.filter(task => task.project_id === selectedProjectId));
		}
	}, [currentTasks, selectedProjectId]);

	const tasksByStatus = {
		'todo': filteredTasks.filter(task => task.status === 'todo'),
		'in-progress': filteredTasks.filter(task => task.status === 'in-progress'),
		'done': filteredTasks.filter(task => task.status === 'done'),
		'blocked': filteredTasks.filter(task => task.status === 'blocked'),
		'cancelled': filteredTasks.filter(task => task.status === 'cancelled'),
	};

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string);
	};

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event;
		setActiveId(null);

		if (!over) return;

		const taskId = active.id as string;
		const newStatus = over.id as string;

		// Find the task being moved
		const task = filteredTasks.find(t => t.id === taskId);
		if (!task || task.status === newStatus) return;

		// Update task status in Supabase
		if (plugin.supabase) {
			try {
				const { error } = await plugin.supabase
					.from('tasks')
					.update({ status: newStatus })
					.eq('id', taskId);

				if (error) throw error;
				new Notice(`Task moved to ${newStatus}`);

				// Refresh data if real-time is disabled
				if (!plugin.settings.enableRealtime) {
					plugin.loadTasks();
				}
			} catch (error) {
				console.error('Failed to update task status:', error);
				new Notice('Failed to move task');
			}
		}
	};

	const draggedTask = activeId ? filteredTasks.find(task => task.id === activeId) : null;

	return React.createElement(DndContext, {
		sensors,
		onDragStart: handleDragStart,
		onDragEnd: handleDragEnd
	},
		React.createElement('div', { className: 'kanban-board' },
			React.createElement('div', { className: 'kanban-header' },
				React.createElement('h2', null, 'Project Kanban'),
				React.createElement(ProjectSelector, {
					projects: currentProjects,
					selectedProjectId,
					onProjectChange
				})
			),
			React.createElement('div', { className: 'kanban-columns' },
				React.createElement(KanbanColumn, {
					title: 'To Do',
					status: 'todo',
					tasks: tasksByStatus['todo'],
					plugin,
					selectedProjectId
				}),
				React.createElement(KanbanColumn, {
					title: 'In Progress',
					status: 'in-progress',
					tasks: tasksByStatus['in-progress'],
					plugin,
					selectedProjectId
				}),
				React.createElement(KanbanColumn, {
					title: 'Done',
					status: 'done',
					tasks: tasksByStatus['done'],
					plugin,
					selectedProjectId
				}),
				React.createElement(KanbanColumn, {
					title: 'Blocked',
					status: 'blocked',
					tasks: tasksByStatus['blocked'],
					plugin,
					selectedProjectId
				}),
				React.createElement(KanbanColumn, {
					title: 'Cancelled',
					status: 'cancelled',
					tasks: tasksByStatus['cancelled'],
					plugin,
					selectedProjectId
				})
			)
		),
		React.createElement(DragOverlay, null,
			draggedTask && React.createElement(TaskCard, {
				task: draggedTask,
				plugin,
				isDragging: true
			})
		)
	);
};

interface ProjectSelectorProps {
	projects: Project[];
	selectedProjectId: string | null;
	onProjectChange: (projectId: string | null) => void;
}

const ProjectSelector: React.FC<ProjectSelectorProps> = ({ projects, selectedProjectId, onProjectChange }) => {
	const selectedProject = projects.find(p => p.id === selectedProjectId);

	return React.createElement('div', { className: 'project-selector' },
		React.createElement('div', { className: 'selector-label' },
			React.createElement('span', null, 'Project: ')
		),
		React.createElement('select', {
			value: selectedProjectId || '',
			onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
				const value = e.target.value;
				onProjectChange(value === '' ? null : value);
			},
			className: 'project-select'
		},
			React.createElement('option', { value: '' }, 'All Projects'),
			projects.map(project =>
				React.createElement('option', {
					key: project.id,
					value: project.id
				}, project.name)
			)
		),
		selectedProject && React.createElement('div', { className: 'project-info' },
			React.createElement('span', { className: `project-status status-${selectedProject.status}` }, 
				selectedProject.status
			),
			selectedProject.description && React.createElement('span', { className: 'project-description' }, 
				selectedProject.description
			)
		)
	);
};

interface ProjectFilterProps {
	projects: Project[];
	selectedProjects: string[];
	onProjectsChange: (projects: string[]) => void;
}

const ProjectFilter: React.FC<ProjectFilterProps> = ({ projects, selectedProjects, onProjectsChange }) => {
	const handleProjectToggle = (projectId: string) => {
		if (selectedProjects.includes(projectId)) {
			onProjectsChange(selectedProjects.filter(id => id !== projectId));
		} else {
			onProjectsChange([...selectedProjects, projectId]);
		}
	};

	const clearFilters = () => {
		onProjectsChange([]);
	};

	return React.createElement('div', { className: 'project-filter' },
		React.createElement('div', { className: 'filter-controls' },
			React.createElement('span', null, 'Filter by projects:'),
			React.createElement('button', { 
				onClick: clearFilters,
				className: 'clear-filters'
			}, 'Show All')
		),
		React.createElement('div', { className: 'project-checkboxes' },
			projects.map(project =>
				React.createElement('label', { key: project.id, className: 'project-checkbox' },
					React.createElement('input', {
						type: 'checkbox',
						checked: selectedProjects.includes(project.id),
						onChange: () => handleProjectToggle(project.id)
					}),
					React.createElement('span', null, project.name)
				)
			)
		)
	);
};

interface KanbanColumnProps {
	title: string;
	status: string;
	tasks: Task[];
	plugin: ProjectManagerPlugin;
	selectedProjectId?: string | null;
}

const KanbanColumn: React.FC<KanbanColumnProps> = ({ title, status, tasks, plugin, selectedProjectId }) => {
	const { setNodeRef, isOver } = useDroppable({
		id: status,
	});

	const taskIds = tasks.map(task => task.id);

	return React.createElement('div', { 
		ref: setNodeRef,
		className: `kanban-column status-${status} ${isOver ? 'column-over' : ''}` 
	},
		React.createElement('div', { className: 'column-header' },
			React.createElement('h3', null, title),
			React.createElement('span', { className: 'task-count' }, tasks.length)
		),
		React.createElement('div', { className: 'column-content' },
			React.createElement(SortableContext, {
				items: taskIds,
				strategy: verticalListSortingStrategy,
				children: tasks.map(task =>
					React.createElement(DraggableTaskCard, {
						key: task.id,
						task,
						plugin
					})
				)
			}),
			React.createElement('button', {
				className: 'add-task-btn',
				onClick: () => new CreateTaskModal(plugin.app, plugin, selectedProjectId).open()
			}, '+ Add Task')
		)
	);
};

interface TaskCardProps {
	task: Task;
	plugin: ProjectManagerPlugin;
	isDragging?: boolean;
}

const DraggableTaskCard: React.FC<TaskCardProps> = ({ task, plugin }) => {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id: task.id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	};

	return React.createElement('div', {
		ref: setNodeRef,
		style,
		...attributes,
		...listeners,
	},
		React.createElement(TaskCard, { task, plugin, isDragging })
	);
};

const TaskCard: React.FC<TaskCardProps> = ({ task, plugin, isDragging }) => {
	const project = plugin.projects.find(p => p.id === task.project_id);

	const handleTaskClick = () => {
		if (!isDragging) {
			// Open task detail modal for editing
			new TaskDetailModal(plugin.app, plugin, task).open();
		}
	};

	const handleLinkClick = (e: React.MouseEvent, link: string) => {
		e.stopPropagation();
		if (task.markdown_file) {
			plugin.app.workspace.openLinkText(task.markdown_file, '');
		}
	};

	const handleDeleteTask = async (e: React.MouseEvent) => {
		e.stopPropagation();
		if (!isDragging && confirm(`Delete task "${task.title}"?`)) {
			try {
				if (plugin.supabase) {
					const { error } = await plugin.supabase
						.from('tasks')
						.delete()
						.eq('id', task.id);
					
					if (error) throw error;
					new Notice('Task deleted successfully');
					
					if (!plugin.settings.enableRealtime) {
						plugin.loadTasks();
					}
				}
			} catch (error) {
				console.error('Failed to delete task:', error);
				new Notice('Failed to delete task');
			}
		}
	};

	const formatDate = (dateString: string) => {
		const date = new Date(dateString);
		return date.toLocaleDateString();
	};

	const getDueDateStatus = () => {
		if (!task.due_date) return '';
		const dueDate = new Date(task.due_date);
		const today = new Date();
		const diffTime = dueDate.getTime() - today.getTime();
		const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
		
		if (diffDays < 0) return 'overdue';
		if (diffDays === 0) return 'due-today';
		if (diffDays <= 3) return 'due-soon';
		return 'due-later';
	};

	return React.createElement('div', { 
		className: `task-card ${isDragging ? 'dragging' : ''} priority-${task.priority}`,
		onClick: handleTaskClick
	},
		React.createElement('div', { className: 'task-header' },
			React.createElement('div', { className: 'task-title-section' },
				React.createElement('span', { className: 'task-title' }, task.title),
				React.createElement('span', { className: `priority-indicator priority-${task.priority}` }, 
					task.priority.charAt(0).toUpperCase()
				)
			),
			React.createElement('button', {
				className: 'delete-task-btn',
				onClick: handleDeleteTask,
				title: 'Delete task'
			}, '×')
		),
		task.description && React.createElement('p', { className: 'task-description' }, 
			task.description.length > 100 ? task.description.substring(0, 100) + '...' : task.description
		),
		React.createElement('div', { className: 'task-meta' },
			project && React.createElement('span', { className: 'project-badge' }, project.name),
			task.due_date && React.createElement('span', { 
				className: `due-date ${getDueDateStatus()}` 
			}, formatDate(task.due_date))
		),
		React.createElement('div', { className: 'task-footer' },
			React.createElement('div', { className: 'task-links' },
				task.markdown_file && React.createElement('button', {
					className: 'link-btn markdown-link',
					onClick: (e: React.MouseEvent) => handleLinkClick(e, task.markdown_file!),
					title: 'Open linked note'
				}, '📝'),
				task.github_repo && React.createElement('a', {
					className: 'link-btn github-link',
					href: `https://github.com/${task.github_repo}`,
					onClick: (e: React.MouseEvent) => e.stopPropagation(),
					title: 'Open GitHub repo',
					target: '_blank'
				}, '🔗')
			),
			React.createElement('span', { className: 'created-date' }, 
				formatDate(task.created_at)
			)
		)
	);
};
