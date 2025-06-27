# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the **Gemini CLI** - a command-line AI workflow tool that connects to Google's Gemini API and xAI's Grok API, understands code, and accelerates development workflows. The CLI can query large codebases, generate new applications, automate tasks, and use tools to interact with the local environment.

**Provider Support**: The CLI supports both Gemini (Google) and Grok (xAI) providers with intelligent context management for different model capabilities.

## Architecture

The project uses a **monorepo structure** with two main packages:

- **`packages/cli/`** - Frontend package handling user interaction, terminal UI (built with React/Ink), input processing, themes, and configuration
- **`packages/core/`** - Backend package managing API communication with Gemini/Grok, prompt construction, tool execution, and session state

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
- **Backend**: Node.js, TypeScript, Google Gemini API (@google/genai), xAI Grok API (OpenAI SDK)
- **Testing**: Vitest, ink-testing-library
- **Tooling**: ESLint, Prettier, esbuild
- **MCP**: Model Context Protocol for extensible tool integration
- **Authentication**: Google Auth Library, xAI API keys
- **AI Providers**: Multi-provider architecture supporting Gemini and Grok models

## Code Architecture Patterns

### Tool System
Tools in `packages/core/src/tools/` extend AI model capabilities:
- **Read-only tools** (glob, grep, read-file) execute without user confirmation
- **Modifying tools** (edit, write-file, shell) require user approval
- Tools are registered in the tool registry and invoked by the core package
- **Smart Context Management**: ReadManyFiles tool automatically adapts to provider token limits

### Multi-Provider Architecture
- **Provider Abstraction**: `ContentGenerator` interface supports multiple AI providers
- **Gemini Integration**: Native support via `@google/genai` SDK
- **Grok Integration**: Custom `GrokContentGenerator` using OpenAI SDK with xAI endpoints
- **Response Parsing**: Multi-format tool call parsing for different provider response styles
- **Token Management**: Provider-aware token limits and intelligent content chunking

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

## Provider Management & Authentication

### Provider Switching
The CLI supports dynamic provider switching during conversations:
```bash
/provider grok        # Switch to Grok 3 Latest
/provider grok-mini   # Switch to Grok 3 Mini Latest  
/provider gemini      # Switch back to Gemini
```

### Authentication Methods
**Gemini Provider:**
- Personal Google accounts (default)
- API keys from Google AI Studio  
- Google Workspace accounts
- Service account authentication

**Grok Provider:**
- xAI API keys (set via `XAI_API_KEY` environment variable)
- Account-based authentication through xAI platform

### Smart Context Management
The CLI automatically adapts to different provider capabilities:

**Token Limits:**
- **Gemini**: 1M+ tokens (models like gemini-1.5-flash, gemini-2.0-flash)
- **Grok**: 131K tokens (grok-3-latest, grok-3-mini-latest)

**ReadManyFiles Tool Intelligence:**
- **Standard Mode**: Reads all requested files (Gemini with large context windows)
- **Smart Selection Mode**: Activated automatically for Grok when >20 files detected
  1. **File Preview Stage**: Reads first 5 lines of each file for context
  2. **AI Selection Stage**: Asks Grok to select 15-20 most relevant files based on user query
  3. **Token-Aware Reading**: Processes selected files within 100K token budget
  4. **Graceful Fallback**: Multiple fallback strategies if any stage fails

**Tool Call Format Support:**
- **Gemini**: Native structured function calls
- **Grok**: Multi-format parsing including:
  - Standard OpenAI tool_calls format
  - Custom `[function_call]` JSON blocks
  - Grok Mini `[tool_call: func for param 'value']` format
  - Simple "Calling function X" patterns

## Deployment & Execution

Sandbox execution uses Docker/Podman containers for secure tool execution with configurable permission levels.