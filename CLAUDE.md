# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Obsidian plugin for comprehensive project and task management with Supabase integration. The plugin allows users to create, manage, and track projects and tasks directly within Obsidian, with real-time synchronization via Supabase.

## Development Commands

- `npm run dev` - Start development build with watch mode (uses esbuild)
- `npm run build` - Build for production (includes TypeScript type checking)
- `npm run version` - Bump version and update manifest/versions files
- `npm i` - Install dependencies

## Architecture Overview

### Core Components

- **ProjectManagerPlugin** (`main.ts:43`) - Main plugin class that extends Obsidian's Plugin
- **Supabase Integration** - Uses `@supabase/supabase-js` for backend data management
- **Modal Classes** - UI components for project/task creation and management
- **Settings Management** - Plugin configuration via Obsidian's settings system

### Data Models

- **Project** (`main.ts:18-27`) - Project entity with status (active/completed/archived)
- **Task** (`main.ts:29-41`) - Task entity with status (todo/in-progress/done/blocked/cancelled) and priority levels
- **ProjectManagerSettings** (`main.ts:4-9`) - Plugin configuration including Supabase credentials

### Key Features

- Real-time synchronization with Supabase using PostgreSQL change listeners
- Ribbon icon and status bar integration
- Command palette integration for quick actions
- Note linking to projects and tasks via markdown file paths
- Settings tab for Supabase configuration

### File Structure

- `main.ts` - Single-file plugin implementation with all classes
- `manifest.json` - Plugin metadata for Obsidian
- `esbuild.config.mjs` - Build configuration using esbuild
- `styles.css` - Plugin styling
- `tsconfig.json` - TypeScript configuration with strict settings

## Database Schema Requirements

The plugin expects Supabase tables:
- `projects` table with columns: id, name, description, status, created_at, updated_at, markdown_file, github_repo
- `tasks` table with columns: id, title, description, status, priority, project_id, created_at, updated_at, due_date, markdown_file, github_repo

## Building and Testing

- Run `npm run build` to build for production (includes type checking with `tsc -noEmit -skipLibCheck`)
- For development, use `npm run dev` which starts esbuild in watch mode
- Plugin files (`main.js`, `manifest.json`, `styles.css`) need to be copied to Obsidian's plugin directory for testing

## Configuration

Plugin requires Supabase URL and anonymous key to be configured in settings. Optional settings include default project path and real-time sync toggle.