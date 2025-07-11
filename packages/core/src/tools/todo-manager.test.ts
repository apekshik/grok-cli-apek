/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TodoManagerTool, TodoManagerParams } from './todo-manager.js';
import { Config } from '../config/config.js';

vi.mock('../config/config.js');

describe('TodoManagerTool', () => {
  let todoManager: TodoManagerTool;
  let mockConfig: Config;

  beforeEach(() => {
    mockConfig = {} as Config;
    todoManager = new TodoManagerTool(mockConfig);
  });

  describe('constructor', () => {
    it('should create a TodoManagerTool instance with correct properties', () => {
      expect(todoManager.name).toBe('manage_todos');
      expect(todoManager.displayName).toBe('Todo Manager');
      expect(todoManager.isOutputMarkdown).toBe(true);
      expect(todoManager.canUpdateOutput).toBe(false);
    });
  });

  describe('validateToolParams', () => {
    it('should return null for valid list operation', () => {
      const params: TodoManagerParams = { action: 'list' };
      expect(todoManager.validateToolParams(params)).toBeNull();
    });

    it('should return error for create without content', () => {
      const params: TodoManagerParams = { action: 'create' };
      const result = todoManager.validateToolParams(params);
      expect(result).toBe('Create action requires content');
    });

    it('should return null for create with content', () => {
      const params: TodoManagerParams = { 
        action: 'create', 
        content: 'Test todo item' 
      };
      expect(todoManager.validateToolParams(params)).toBeNull();
    });

    it('should return error for update without todoId', () => {
      const params: TodoManagerParams = { action: 'update' };
      const result = todoManager.validateToolParams(params);
      expect(result).toBe('update action requires todoId');
    });

    it('should return error for delete without todoId', () => {
      const params: TodoManagerParams = { action: 'delete' };
      const result = todoManager.validateToolParams(params);
      expect(result).toBe('delete action requires todoId');
    });

    it('should return null for valid update operation', () => {
      const params: TodoManagerParams = { 
        action: 'update', 
        todoId: 'test-id' 
      };
      expect(todoManager.validateToolParams(params)).toBeNull();
    });
  });

  describe('getDescription', () => {
    it('should format create description', () => {
      const params: TodoManagerParams = { 
        action: 'create', 
        content: 'Test todo', 
        priority: 'high' 
      };
      const description = todoManager.getDescription(params);
      expect(description).toBe('Create TODO: "Test todo" (high priority)');
    });

    it('should format update description', () => {
      const params: TodoManagerParams = { 
        action: 'update', 
        todoId: 'test-id', 
        status: 'completed' 
      };
      const description = todoManager.getDescription(params);
      expect(description).toBe('Update TODO test-id: status → completed');
    });

    it('should format delete description', () => {
      const params: TodoManagerParams = { 
        action: 'delete', 
        todoId: 'test-id' 
      };
      const description = todoManager.getDescription(params);
      expect(description).toBe('Delete TODO: test-id');
    });

    it('should format list description', () => {
      const params: TodoManagerParams = { action: 'list' };
      const description = todoManager.getDescription(params);
      expect(description).toBe('List all TODO items');
    });

    it('should format clear description', () => {
      const params: TodoManagerParams = { action: 'clear' };
      const description = todoManager.getDescription(params);
      expect(description).toBe('Clear completed TODO items');
    });
  });

  describe('shouldConfirmExecute', () => {
    it('should return false for all operations', async () => {
      const operations = ['create', 'update', 'delete', 'list', 'clear'];
      
      for (const operation of operations) {
        const params: TodoManagerParams = { 
          action: operation as any,
          ...(operation === 'create' && { content: 'Test' }),
          ...(operation === 'update' && { todoId: 'test' }),
          ...(operation === 'delete' && { todoId: 'test' })
        };
        
        const result = await todoManager.shouldConfirmExecute(params, new AbortController().signal);
        expect(result).toBe(false);
      }
    });
  });

  describe('execute', () => {
    it('should return error for invalid parameters', async () => {
      const params: TodoManagerParams = { action: 'create' }; // missing content
      const result = await todoManager.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toBe('Error: Create action requires content');
      expect(result.returnDisplay).toMatch(/TODO Manager Error/);
    });

    it('should create a new todo', async () => {
      const params: TodoManagerParams = { 
        action: 'create', 
        content: 'Test todo item',
        priority: 'high',
        status: 'pending'
      };
      
      const result = await todoManager.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toContain('Created TODO: Test todo item');
      expect(result.llmContent).toContain('high priority');
      expect(result.llmContent).toContain('pending');
      expect(result.returnDisplay).toMatch(/TODO CREATE/);
    });

    it('should list todos when none exist', async () => {
      const params: TodoManagerParams = { action: 'list' };
      const result = await todoManager.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toBe('No TODO items found.');
      expect(result.returnDisplay).toMatch(/No items in the TODO list/);
    });

    it('should create and list todos', async () => {
      // Create a todo first
      const createParams: TodoManagerParams = { 
        action: 'create', 
        content: 'First todo',
        priority: 'medium'
      };
      
      await todoManager.execute(createParams, new AbortController().signal);
      
      // List todos
      const listParams: TodoManagerParams = { action: 'list' };
      const result = await todoManager.execute(listParams, new AbortController().signal);
      
      expect(result.llmContent).toContain('TODO List (1 items)');
      expect(result.llmContent).toContain('First todo');
      expect(result.returnDisplay).toMatch(/TODO Progress/);
    });

    it('should update a todo', async () => {
      // Create a todo first
      const createParams: TodoManagerParams = { 
        action: 'create', 
        content: 'Test todo',
        todoId: 'test-id'
      };
      
      await todoManager.execute(createParams, new AbortController().signal);
      
      // Update the todo
      const updateParams: TodoManagerParams = { 
        action: 'update', 
        todoId: 'test-id',
        status: 'completed'
      };
      
      const result = await todoManager.execute(updateParams, new AbortController().signal);
      
      expect(result.llmContent).toContain('Updated TODO: Test todo');
      expect(result.llmContent).toContain('completed');
      expect(result.returnDisplay).toMatch(/TODO UPDATE/);
    });

    it('should handle update of non-existent todo', async () => {
      const params: TodoManagerParams = { 
        action: 'update', 
        todoId: 'non-existent',
        status: 'completed'
      };
      
      const result = await todoManager.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toBe('TODO not found: non-existent');
      expect(result.returnDisplay).toMatch(/TODO Not Found/);
    });

    it('should delete a todo', async () => {
      // Create a todo first
      const createParams: TodoManagerParams = { 
        action: 'create', 
        content: 'Test todo',
        todoId: 'test-id'
      };
      
      await todoManager.execute(createParams, new AbortController().signal);
      
      // Delete the todo
      const deleteParams: TodoManagerParams = { 
        action: 'delete', 
        todoId: 'test-id'
      };
      
      const result = await todoManager.execute(deleteParams, new AbortController().signal);
      
      expect(result.llmContent).toContain('Deleted TODO: Test todo');
      expect(result.returnDisplay).toMatch(/Test todo/);
    });

    it('should handle delete of non-existent todo', async () => {
      const params: TodoManagerParams = { 
        action: 'delete', 
        todoId: 'non-existent'
      };
      
      const result = await todoManager.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toBe('TODO not found: non-existent');
      expect(result.returnDisplay).toMatch(/TODO Not Found/);
    });

    it('should clear completed todos', async () => {
      // Create some todos
      await todoManager.execute({ 
        action: 'create', 
        content: 'Todo 1',
        todoId: 'todo1'
      }, new AbortController().signal);
      
      await todoManager.execute({ 
        action: 'create', 
        content: 'Todo 2',
        todoId: 'todo2'
      }, new AbortController().signal);
      
      // Mark one as completed
      await todoManager.execute({ 
        action: 'update', 
        todoId: 'todo1',
        status: 'completed'
      }, new AbortController().signal);
      
      // Clear completed
      const clearParams: TodoManagerParams = { action: 'clear' };
      const result = await todoManager.execute(clearParams, new AbortController().signal);
      
      expect(result.llmContent).toContain('Cleared 1 completed TODO items');
      expect(result.returnDisplay).toMatch(/TODO Cleanup/);
    });

    it('should handle in_progress status management', async () => {
      // Create two todos
      await todoManager.execute({ 
        action: 'create', 
        content: 'Todo 1',
        todoId: 'todo1',
        status: 'in_progress'
      }, new AbortController().signal);
      
      await todoManager.execute({ 
        action: 'create', 
        content: 'Todo 2',
        todoId: 'todo2',
        status: 'in_progress'
      }, new AbortController().signal);
      
      // List todos to check status
      const listParams: TodoManagerParams = { action: 'list' };
      const result = await todoManager.execute(listParams, new AbortController().signal);
      
      // Should have only one in_progress todo
      expect(result.llmContent).toContain('Todo 2');
      expect(result.llmContent).toContain('in_progress');
    });

    it('should handle unknown action', async () => {
      const params: TodoManagerParams = { action: 'unknown' as any };
      const result = await todoManager.execute(params, new AbortController().signal);
      
      expect(result.llmContent).toBe('Unknown action: unknown');
      expect(result.returnDisplay).toMatch(/Unknown action: unknown/);
    });
  });

  describe('status icon formatting', () => {
    it('should format status icons correctly', () => {
      const todoManager = new TodoManagerTool(mockConfig);
      
      // Test private method via accessing the formatted display
      const testTodo = (status: string) => {
        return (todoManager as any).getStatusIcon(status);
      };
      
      expect(testTodo('completed')).toBe('☒');
      expect(testTodo('in_progress')).toBe('🔄');
      expect(testTodo('cancelled')).toBe('❌');
      expect(testTodo('pending')).toBe('☐');
    });
  });

  describe('priority color formatting', () => {
    it('should format priority colors correctly', () => {
      const todoManager = new TodoManagerTool(mockConfig);
      
      const testPriority = (priority: string) => {
        return (todoManager as any).getPriorityColor(priority);
      };
      
      expect(testPriority('high')).toBe('🔴 ');
      expect(testPriority('medium')).toBe('🟡 ');
      expect(testPriority('low')).toBe('🟢 ');
      expect(testPriority('unknown')).toBe('');
    });
  });
});