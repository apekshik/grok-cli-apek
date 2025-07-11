/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
  ToolCallConfirmationDetails,
  ToolExecuteConfirmationDetails,
  ToolConfirmationOutcome,
} from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import stripAnsi from 'strip-ansi';

export interface GitToolParams {
  operation: 'status' | 'diff' | 'log' | 'add' | 'commit' | 'branch' | 'checkout' | 'pull' | 'push' | 'stash' | 'reset' | 'merge' | 'rebase';
  files?: string[];
  message?: string;
  branch?: string;
  options?: string[];
  directory?: string;
}

interface GitOperationResult {
  success: boolean;
  stdout: string;
  stderr: string;
  command: string;
}

export class GitTool extends BaseTool<GitToolParams, ToolResult> {
  static Name: string = 'git_operation';
  private readonly targetDir: string;

  constructor(targetDir: string, private readonly config: Config) {
    const toolDisplayName = 'Git';
    const toolDescription = `Execute Git operations with structured output and safety checks.

Supports common Git operations:
- status: Show working tree status
- diff: Show changes between commits, commit and working tree, etc
- log: Show commit history
- add: Add files to staging area
- commit: Record changes to repository
- branch: List, create, or delete branches
- checkout: Switch branches or restore files
- pull: Fetch from and integrate with remote repository
- push: Update remote repository
- stash: Temporarily store changes
- reset: Reset current HEAD to specified state
- merge: Join two or more development histories
- rebase: Reapply commits on top of another base tip

All operations are executed within the target directory and provide structured output for AI understanding.
Destructive operations require user confirmation.`;

    const toolParameterSchema = {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['status', 'diff', 'log', 'add', 'commit', 'branch', 'checkout', 'pull', 'push', 'stash', 'reset', 'merge', 'rebase'],
          description: 'Git operation to perform'
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files to operate on (for add, checkout, etc.)'
        },
        message: {
          type: 'string',
          description: 'Commit message (for commit operation)'
        },
        branch: {
          type: 'string',
          description: 'Branch name (for branch, checkout, merge, rebase operations)'
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: 'Additional Git options (e.g., ["--staged", "--cached"])'
        },
        directory: {
          type: 'string',
          description: 'Working directory (defaults to target directory)'
        }
      },
      required: ['operation']
    };

    super(
      GitTool.Name,
      toolDisplayName,
      toolDescription,
      toolParameterSchema,
      true, // output is markdown
      false, // output cannot be updated
    );

    this.targetDir = targetDir;
  }

  getDescription(params: GitToolParams): string {
    const dir = params.directory || this.targetDir;
    let description = `git ${params.operation}`;
    
    if (params.files && params.files.length > 0) {
      description += ` ${params.files.join(' ')}`;
    }
    
    if (params.branch) {
      description += ` ${params.branch}`;
    }
    
    if (params.message) {
      description += ` -m "${params.message}"`;
    }
    
    if (params.options && params.options.length > 0) {
      description += ` ${params.options.join(' ')}`;
    }
    
    description += ` [in ${dir}]`;
    
    return description;
  }

  validateToolParams(params: GitToolParams): string | null {
    if (!SchemaValidator.validate(this.parameterSchema as Record<string, unknown>, params)) {
      return 'Invalid parameters for Git operation';
    }

    // Validate operation-specific requirements
    switch (params.operation) {
      case 'commit':
        if (!params.message) {
          return 'Commit operation requires a message';
        }
        break;
      case 'checkout':
      case 'merge':
      case 'rebase':
        if (!params.branch && (!params.files || params.files.length === 0)) {
          return `${params.operation} operation requires either a branch name or files`;
        }
        break;
      case 'add':
        if (!params.files || params.files.length === 0) {
          return 'Add operation requires files to be specified';
        }
        break;
    }

    // Validate directory if specified
    if (params.directory) {
      if (!path.isAbsolute(params.directory)) {
        return 'Directory must be an absolute path';
      }
      if (!params.directory.startsWith(this.targetDir)) {
        return `Directory must be within target directory: ${this.targetDir}`;
      }
    }

    return null;
  }

  async shouldConfirmExecute(
    params: GitToolParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return false;
    }

    // Operations that modify the repository require confirmation
    const destructiveOperations = ['add', 'commit', 'checkout', 'pull', 'push', 'stash', 'reset', 'merge', 'rebase'];
    
    if (destructiveOperations.includes(params.operation)) {
      return {
        type: 'exec',
        title: `Git ${params.operation.toUpperCase()}`,
        command: this.buildGitCommand(params),
        rootCommand: 'git',
        onConfirm: async (outcome: ToolConfirmationOutcome) => {
          if (outcome === ToolConfirmationOutcome.ProceedAlways) {
            // Could implement auto-approval for git operations
          }
        },
      };
    }

    return false;
  }

  private buildGitCommand(params: GitToolParams): string {
    let command = `git ${params.operation}`;
    
    if (params.options && params.options.length > 0) {
      command += ` ${params.options.join(' ')}`;
    }
    
    switch (params.operation) {
      case 'add':
        if (params.files && params.files.length > 0) {
          command += ` ${params.files.join(' ')}`;
        }
        break;
      case 'commit':
        if (params.message) {
          command += ` -m "${params.message}"`;
        }
        if (params.files && params.files.length > 0) {
          command += ` ${params.files.join(' ')}`;
        }
        break;
      case 'checkout':
        if (params.branch) {
          command += ` ${params.branch}`;
        }
        if (params.files && params.files.length > 0) {
          command += ` ${params.files.join(' ')}`;
        }
        break;
      case 'branch':
        if (params.branch) {
          command += ` ${params.branch}`;
        }
        break;
      case 'merge':
      case 'rebase':
        if (params.branch) {
          command += ` ${params.branch}`;
        }
        break;
      case 'diff':
        if (params.files && params.files.length > 0) {
          command += ` ${params.files.join(' ')}`;
        }
        break;
      case 'log':
        if (params.files && params.files.length > 0) {
          command += ` ${params.files.join(' ')}`;
        }
        break;
    }
    
    return command;
  }

  async execute(params: GitToolParams, signal: AbortSignal): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: ${validationError}`,
        returnDisplay: `## Git Operation Error\n\n${validationError}`,
      };
    }

    const workingDir = params.directory || this.targetDir;
    const command = this.buildGitCommand(params);

    try {
      const result = await this.executeGitCommand(params, workingDir, signal);
      
      if (result.success) {
        return {
          llmContent: this.formatGitOutput(params.operation, result.stdout, result.stderr),
          returnDisplay: this.formatGitOutputForDisplay(params.operation, result, workingDir),
        };
      } else {
        return {
          llmContent: `Git ${params.operation} failed: ${result.stderr || result.stdout}`,
          returnDisplay: `## Git ${params.operation.toUpperCase()} Failed\n\n\`\`\`\n${result.stderr || result.stdout}\n\`\`\``,
        };
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Git operation failed: ${errorMessage}`,
        returnDisplay: `## Git Operation Failed\n\n${errorMessage}`,
      };
    }
  }

  private async executeGitCommand(
    params: GitToolParams,
    workingDir: string,
    signal: AbortSignal,
  ): Promise<GitOperationResult> {
    const args = this.buildGitArgs(params);
    const command = `git ${args.join(' ')}`;

    return new Promise((resolve, reject) => {
      const gitProcess = spawn('git', args, {
        cwd: workingDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      gitProcess.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      gitProcess.on('close', (code) => {
        resolve({
          success: code === 0,
          stdout: stripAnsi(stdout),
          stderr: stripAnsi(stderr),
          command,
        });
      });

      gitProcess.on('error', (error) => {
        reject(error);
      });

      signal.addEventListener('abort', () => {
        gitProcess.kill();
        reject(new Error('Git operation was aborted'));
      });
    });
  }

  private buildGitArgs(params: GitToolParams): string[] {
    const args: string[] = [params.operation];
    
    if (params.options && params.options.length > 0) {
      args.push(...params.options);
    }
    
    switch (params.operation) {
      case 'add':
        if (params.files && params.files.length > 0) {
          args.push(...params.files);
        }
        break;
      case 'commit':
        if (params.message) {
          args.push('-m', params.message);
        }
        if (params.files && params.files.length > 0) {
          args.push(...params.files);
        }
        break;
      case 'checkout':
        if (params.branch) {
          args.push(params.branch);
        }
        if (params.files && params.files.length > 0) {
          args.push(...params.files);
        }
        break;
      case 'branch':
        if (params.branch) {
          args.push(params.branch);
        }
        break;
      case 'merge':
      case 'rebase':
        if (params.branch) {
          args.push(params.branch);
        }
        break;
      case 'diff':
      case 'log':
        if (params.files && params.files.length > 0) {
          args.push(...params.files);
        }
        break;
    }
    
    return args;
  }

  private formatGitOutput(operation: string, stdout: string, stderr: string): string {
    let output = stdout;
    
    if (stderr) {
      output += `\n${stderr}`;
    }
    
    // Add operation context for AI understanding
    switch (operation) {
      case 'status':
        return `Git repository status:\n${output}`;
      case 'diff':
        return `Git diff output:\n${output}`;
      case 'log':
        return `Git commit history:\n${output}`;
      case 'branch':
        return `Git branches:\n${output}`;
      default:
        return `Git ${operation} output:\n${output}`;
    }
  }

  private formatGitOutputForDisplay(operation: string, result: GitOperationResult, workingDir: string): string {
    let display = `## Git ${operation.toUpperCase()}\n\n`;
    display += `**Command:** \`${result.command}\`\n`;
    display += `**Directory:** \`${workingDir}\`\n\n`;
    
    if (result.stdout) {
      display += `**Output:**\n\`\`\`\n${result.stdout}\n\`\`\`\n\n`;
    }
    
    if (result.stderr) {
      display += `**Errors/Warnings:**\n\`\`\`\n${result.stderr}\n\`\`\`\n\n`;
    }
    
    return display.trim();
  }
}