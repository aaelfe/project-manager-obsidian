# Project Manager for Obsidian

A comprehensive project and task management plugin for Obsidian with Supabase integration and Kanban board visualization.

> **Backend Repository**: The backend API and database setup for this plugin can be found at [project-manager-backend](https://github.com/aaelfe/project-manager-backend)

## Features

- **Project Management**: Create, organize, and track projects with status tracking (active/completed/archived)
- **Task Management**: Manage tasks with priorities, statuses, and due dates
- **Kanban Board**: Visual drag-and-drop task management interface
- **Supabase Integration**: Real-time synchronization across devices
- **Note Linking**: Connect projects and tasks to specific markdown files
- **GitHub Integration**: Link projects and tasks to GitHub repositories

## Installation

### Manual Installation

1. Download the latest release files: `main.js`, `manifest.json`, and `styles.css`
2. Copy them to your vault's plugins folder: `VaultFolder/.obsidian/plugins/project-manager/`
3. Reload Obsidian and enable the plugin in Settings → Community Plugins

### Development Setup

1. Clone this repository
2. Install dependencies: `npm install`
3. Start development build: `npm run dev`
4. Copy `main.js`, `manifest.json`, and `styles.css` to your test vault's plugin directory

## Configuration

1. Go to Settings → Project Manager
2. Enter your Supabase URL and anonymous key
3. Configure optional settings:
   - Default project path
   - Enable/disable real-time synchronization

## Backend Setup

For the complete backend setup, database schema, API endpoints, and MCP server configuration, see the [project-manager-backend](https://github.com/aaelfe/project-manager-backend) repository.

## Usage

### Commands
- **Open Project Manager**: Opens the main project management interface
- **Open Kanban Board**: Opens the visual task board
- **Create New Project**: Quick project creation
- **Create New Task**: Quick task creation

### Kanban Board
- Drag and drop tasks between columns (Todo, In Progress, Done, Blocked, Cancelled)
- Filter tasks by project
- Real-time updates across all connected devices

## Development

### Scripts
- `npm run dev` - Development build with watch mode
- `npm run build` - Production build with TypeScript checking
- `npm run version` - Bump version and update manifest

### Architecture
- **React Components**: Modern UI with drag-and-drop functionality
- **Supabase Client**: Real-time database synchronization
- **Obsidian API**: Native plugin integration
- **TypeScript**: Full type safety

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and feature requests, please use the GitHub issue tracker.