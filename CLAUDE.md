# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Gemini CLI** - a command-line AI workflow tool that connects to Google's Gemini API, understands code, and accelerates development workflows. The CLI can query large codebases, generate new applications, automate tasks, and use tools to interact with the local environment.

## Architecture

The project uses a **monorepo structure** with two main packages:

- **`packages/cli/`** - Frontend package handling user interaction, terminal UI (built with React/Ink), input processing, themes, and configuration
- **`packages/core/`** - Backend package managing API communication with Gemini, prompt construction, tool execution, and session state

## Development Commands

### Build and Development
```bash
# Full preflight check (build, test, typecheck, lint) - ALWAYS run before commits
npm run preflight

# Build everything
npm run build

# Build packages only
npm run build:packages

# Build CLI only
npm run build:cli

# Build core only  
npm run build:core

# Start development
npm start

# Debug mode
npm run debug
```

### Testing
```bash
# Run all tests
npm test

# Run integration tests
npm run test:integration:all
npm run test:integration:sandbox:none
npm run test:integration:sandbox:docker

# Run end-to-end tests
npm run test:e2e

# Run tests with coverage
npm run test:ci
```

### Linting and Formatting
```bash
# Lint code
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Format code
npm run format

# TypeScript type checking
npm run typecheck
```

## Key Technologies & Frameworks

- **Frontend**: React with Ink (for terminal UI), TypeScript
- **Backend**: Node.js, TypeScript, Google Gemini API (@google/genai)
- **Testing**: Vitest, ink-testing-library
- **Tooling**: ESLint, Prettier, esbuild
- **MCP**: Model Context Protocol for extensible tool integration
- **Authentication**: Google Auth Library for API access

## Code Architecture Patterns

### Tool System
Tools in `packages/core/src/tools/` extend Gemini's capabilities:
- **Read-only tools** (glob, grep, read-file) execute without user confirmation
- **Modifying tools** (edit, write-file, shell) require user approval
- Tools are registered in the tool registry and invoked by the core package

### React/Ink UI Components
- Components in `packages/cli/src/ui/components/` follow functional component patterns
- Use React hooks for state management and side effects
- Context providers manage global state (SessionContext, StreamingContext)
- Terminal-specific UI patterns with maxWidth constraints

### Configuration System
- Settings stored in `~/.gemini/` directory
- Theme system with multiple color schemes
- Authentication handled via Google OAuth2 or API keys
- Sandbox configuration for secure tool execution

## Development Guidelines

### Testing Strategy
- **Framework**: Vitest with comprehensive mocking capabilities
- **React Testing**: Use ink-testing-library for terminal components
- **Mocking**: Mock external dependencies (fs, API clients, MCP servers)
- **File Naming**: `*.test.ts` for logic, `*.test.tsx` for React components

### TypeScript Guidelines
- Prefer plain objects with TypeScript interfaces over classes
- Use `unknown` instead of `any` for type safety
- Leverage ES module syntax for encapsulation
- Avoid manual memoization - let React Compiler handle optimization

### Code Style
- Functional programming patterns with array operators
- Immutable state updates
- No comments policy - write self-documenting code
- Clean separation between CLI frontend and core backend

## Authentication & Deployment

The CLI supports multiple authentication methods:
- Personal Google accounts (default)
- API keys from Google AI Studio  
- Google Workspace accounts
- Service account authentication

Sandbox execution uses Docker/Podman containers for secure tool execution with configurable permission levels.