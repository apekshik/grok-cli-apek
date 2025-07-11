/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitTool, GitToolParams } from './git.js';
import { Config } from '../config/config.js';
import { spawn } from 'child_process';

vi.mock('child_process');
vi.mock('../config/config.js');

describe('GitTool', () => {
  let gitTool: GitTool;
  let mockConfig: Config;
  const targetDir = '/test/target';

  beforeEach(() => {
    mockConfig = {} as Config;
    gitTool = new GitTool(targetDir, mockConfig);
  });

  describe('constructor', () => {
    it('should create a GitTool instance with correct properties', () => {
      expect(gitTool.name).toBe('git_operation');
      expect(gitTool.displayName).toBe('Git');
      expect(gitTool.isOutputMarkdown).toBe(true);
      expect(gitTool.canUpdateOutput).toBe(false);
    });
  });

  describe('validateToolParams', () => {
    it('should return null for valid status operation', () => {
      const params: GitToolParams = { operation: 'status' };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });

    it('should return null for valid diff operation', () => {
      const params: GitToolParams = { operation: 'diff' };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });

    it('should return error for commit without message', () => {
      const params: GitToolParams = { operation: 'commit' };
      const result = gitTool.validateToolParams(params);
      expect(result).toBe('Commit operation requires a message');
    });

    it('should return null for commit with message', () => {
      const params: GitToolParams = { 
        operation: 'commit', 
        message: 'Test commit' 
      };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });

    it('should return error for add without files', () => {
      const params: GitToolParams = { operation: 'add' };
      const result = gitTool.validateToolParams(params);
      expect(result).toBe('Add operation requires files to be specified');
    });

    it('should return null for add with files', () => {
      const params: GitToolParams = { 
        operation: 'add', 
        files: ['file1.txt', 'file2.txt'] 
      };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });

    it('should return error for checkout without branch or files', () => {
      const params: GitToolParams = { operation: 'checkout' };
      const result = gitTool.validateToolParams(params);
      expect(result).toBe('checkout operation requires either a branch name or files');
    });

    it('should return null for checkout with branch', () => {
      const params: GitToolParams = { 
        operation: 'checkout', 
        branch: 'main' 
      };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });

    it('should return null for checkout with files', () => {
      const params: GitToolParams = { 
        operation: 'checkout', 
        files: ['file1.txt'] 
      };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });

    it('should return error for directory outside target', () => {
      const params: GitToolParams = { 
        operation: 'status', 
        directory: '/other/path' 
      };
      const result = gitTool.validateToolParams(params);
      expect(result).toBe(`Directory must be within target directory: ${targetDir}`);
    });

    it('should return error for relative directory path', () => {
      const params: GitToolParams = { 
        operation: 'status', 
        directory: '../other' 
      };
      const result = gitTool.validateToolParams(params);
      expect(result).toBe('Directory must be an absolute path');
    });

    it('should return null for valid directory within target', () => {
      const params: GitToolParams = { 
        operation: 'status', 
        directory: `${targetDir}/subdir` 
      };
      expect(gitTool.validateToolParams(params)).toBeNull();
    });
  });

  describe('getDescription', () => {
    it('should format basic operation description', () => {
      const params: GitToolParams = { operation: 'status' };
      const description = gitTool.getDescription(params);
      expect(description).toBe(`git status [in ${targetDir}]`);
    });

    it('should format operation with files', () => {
      const params: GitToolParams = { 
        operation: 'add', 
        files: ['file1.txt', 'file2.txt'] 
      };
      const description = gitTool.getDescription(params);
      expect(description).toBe(`git add file1.txt file2.txt [in ${targetDir}]`);
    });

    it('should format operation with branch', () => {
      const params: GitToolParams = { 
        operation: 'checkout', 
        branch: 'feature-branch' 
      };
      const description = gitTool.getDescription(params);
      expect(description).toBe(`git checkout feature-branch [in ${targetDir}]`);
    });

    it('should format operation with message', () => {
      const params: GitToolParams = { 
        operation: 'commit', 
        message: 'Test commit message' 
      };
      const description = gitTool.getDescription(params);
      expect(description).toBe(`git commit -m "Test commit message" [in ${targetDir}]`);
    });

    it('should format operation with options', () => {
      const params: GitToolParams = { 
        operation: 'diff', 
        options: ['--staged', '--name-only'] 
      };
      const description = gitTool.getDescription(params);
      expect(description).toBe(`git diff --staged --name-only [in ${targetDir}]`);
    });

    it('should format operation with custom directory', () => {
      const customDir = `${targetDir}/subdir`;
      const params: GitToolParams = { 
        operation: 'status', 
        directory: customDir 
      };
      const description = gitTool.getDescription(params);
      expect(description).toBe(`git status [in ${customDir}]`);
    });
  });

  describe('shouldConfirmExecute', () => {
    it('should return false for read-only operations', async () => {
      const readOnlyOps = ['status', 'diff', 'log', 'branch'];
      
      for (const operation of readOnlyOps) {
        const params: GitToolParams = { operation: operation as any };
        const result = await gitTool.shouldConfirmExecute(params, new AbortController().signal);
        expect(result).toBe(false);
      }
    });

    it('should return confirmation details for destructive operations', async () => {
      const testCases = [
        { operation: 'add', files: ['test.txt'] },
        { operation: 'commit', message: 'Test commit' },
        { operation: 'checkout', branch: 'main' },
        { operation: 'pull' },
        { operation: 'push' },
        { operation: 'stash' },
        { operation: 'reset' },
        { operation: 'merge', branch: 'feature' },
        { operation: 'rebase', branch: 'main' }
      ];
      
      for (const testCase of testCases) {
        const params: GitToolParams = testCase as any;
        
        const result = await gitTool.shouldConfirmExecute(params, new AbortController().signal);
        expect(result).not.toBe(false);
        if (result) {
          expect(result.type).toBe('exec');
          expect(result.title).toBe(`Git ${testCase.operation.toUpperCase()}`);
          if (result.type === 'exec') {
            expect(result.rootCommand).toBe('git');
          }
        }
      }
    });

    it('should return false for invalid parameters', async () => {
      const params: GitToolParams = { operation: 'commit' }; // missing message
      const result = await gitTool.shouldConfirmExecute(params, new AbortController().signal);
      expect(result).toBe(false);
    });
  });

  describe('execute', () => {
    const mockSpawn = vi.mocked(spawn);
    
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return error for invalid parameters', async () => {
      const params: GitToolParams = { operation: 'commit' }; // missing message
      const result = await gitTool.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toBe('Error: Commit operation requires a message');
      expect(result.returnDisplay).toMatch(/Git Operation Error/);
    });

    it('should execute git status successfully', async () => {
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const params: GitToolParams = { operation: 'status' };
      const executePromise = gitTool.execute(params, new AbortController().signal);

      // Simulate successful execution
      const onClose = mockProcess.on.mock.calls.find(call => call[0] === 'close')?.[1];
      const onStdout = mockProcess.stdout.on.mock.calls.find(call => call[0] === 'data')?.[1];
      
      // Simulate git status output
      onStdout?.(Buffer.from('On branch main\nnothing to commit, working tree clean\n'));
      onClose?.(0); // exit code 0 (success)

      const result = await executePromise;

      expect(mockSpawn).toHaveBeenCalledWith('git', ['status'], {
        cwd: targetDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(result.llmContent).toContain('Git repository status:');
      expect(result.llmContent).toContain('On branch main');
      expect(result.returnDisplay).toMatch(/Git STATUS/);
    });

    it('should execute git diff with files', async () => {
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const params: GitToolParams = { 
        operation: 'diff', 
        files: ['src/file1.ts', 'src/file2.ts'] 
      };
      const executePromise = gitTool.execute(params, new AbortController().signal);

      // Simulate successful execution
      const onClose = mockProcess.on.mock.calls.find(call => call[0] === 'close')?.[1];
      const onStdout = mockProcess.stdout.on.mock.calls.find(call => call[0] === 'data')?.[1];
      
      onStdout?.(Buffer.from('diff --git a/src/file1.ts b/src/file1.ts\n+added line\n'));
      onClose?.(0);

      const result = await executePromise;

      expect(mockSpawn).toHaveBeenCalledWith('git', ['diff', 'src/file1.ts', 'src/file2.ts'], {
        cwd: targetDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(result.llmContent).toContain('Git diff output:');
    });

    it('should handle git command failure', async () => {
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const params: GitToolParams = { operation: 'status' };
      const executePromise = gitTool.execute(params, new AbortController().signal);

      // Simulate failure
      const onClose = mockProcess.on.mock.calls.find(call => call[0] === 'close')?.[1];
      const onStderr = mockProcess.stderr.on.mock.calls.find(call => call[0] === 'data')?.[1];
      
      onStderr?.(Buffer.from('fatal: not a git repository\n'));
      onClose?.(128); // git error code

      const result = await executePromise;

      expect(result.llmContent).toContain('Git status failed:');
      expect(result.llmContent).toContain('fatal: not a git repository');
      expect(result.returnDisplay).toMatch(/Git STATUS Failed/);
    });

    it('should handle process error', async () => {
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const params: GitToolParams = { operation: 'status' };
      const executePromise = gitTool.execute(params, new AbortController().signal);

      // Simulate process error
      const onError = mockProcess.on.mock.calls.find(call => call[0] === 'error')?.[1];
      onError?.(new Error('Command not found'));

      const result = await executePromise;

      expect(result.llmContent).toContain('Git operation failed:');
      expect(result.llmContent).toContain('Command not found');
    });

    it('should handle abortion signal', async () => {
      const mockProcess = {
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
      };

      mockSpawn.mockReturnValue(mockProcess as any);

      const abortController = new AbortController();
      const params: GitToolParams = { operation: 'status' };
      const executePromise = gitTool.execute(params, abortController.signal);

      // Simulate abortion
      abortController.abort();

      const result = await executePromise;

      expect(mockProcess.kill).toHaveBeenCalled();
      expect(result.llmContent).toContain('Git operation was aborted');
    });
  });

  describe('buildGitCommand', () => {
    it('should build correct command for status', () => {
      const params: GitToolParams = { operation: 'status' };
      const command = (gitTool as any).buildGitCommand(params);
      expect(command).toBe('git status');
    });

    it('should build correct command for add with files', () => {
      const params: GitToolParams = { 
        operation: 'add', 
        files: ['file1.txt', 'file2.txt'] 
      };
      const command = (gitTool as any).buildGitCommand(params);
      expect(command).toBe('git add file1.txt file2.txt');
    });

    it('should build correct command for commit with message', () => {
      const params: GitToolParams = { 
        operation: 'commit', 
        message: 'Test commit' 
      };
      const command = (gitTool as any).buildGitCommand(params);
      expect(command).toBe('git commit -m "Test commit"');
    });

    it('should build correct command for checkout with branch', () => {
      const params: GitToolParams = { 
        operation: 'checkout', 
        branch: 'feature-branch' 
      };
      const command = (gitTool as any).buildGitCommand(params);
      expect(command).toBe('git checkout feature-branch');
    });

    it('should build correct command with options', () => {
      const params: GitToolParams = { 
        operation: 'diff', 
        options: ['--staged', '--name-only'] 
      };
      const command = (gitTool as any).buildGitCommand(params);
      expect(command).toBe('git diff --staged --name-only');
    });
  });
});