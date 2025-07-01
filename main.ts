import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';

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

export default class ProjectManagerPlugin extends Plugin {
	settings: ProjectManagerSettings;
	supabase: SupabaseClient | null = null;
	projects: Project[] = [];
	tasks: Task[] = [];
	realtimeChannel: RealtimeChannel | null = null;
	statusBarItem: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Add ribbon icon for project manager
		const ribbonIconEl = this.addRibbonIcon('folder-tree', 'Project Manager', (evt: MouseEvent) => {
			this.openProjectManagerView();
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
				this.openProjectManagerView();
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
		} catch (error) {
			console.error('Failed to load tasks:', error);
			new Notice('Failed to load tasks');
		}
	}

	openProjectManagerView() {
		new ProjectManagerModal(this.app, this).open();
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
	constructor(app: App, private plugin: ProjectManagerPlugin) {
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
			projectSelect.createEl('option', {value: project.id, text: project.name});
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
