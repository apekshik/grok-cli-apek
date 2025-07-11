/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
  ToolCallConfirmationDetails,
} from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
  createdAt: Date;
  updatedAt: Date;
  parentId?: string;
  subtasks?: TodoItem[];
}

export interface TodoManagerParams {
  action: 'create' | 'update' | 'delete' | 'list' | 'clear';
  todoId?: string;
  content?: string;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority?: 'high' | 'medium' | 'low';
  parentId?: string;
  todos?: Array<Partial<TodoItem>>;
}

export class TodoManagerTool extends BaseTool<TodoManagerParams, ToolResult> {
  static Name: string = 'manage_todos';
  private todos: Map<string, TodoItem> = new Map();
  private currentTodoId: string | null = null;

  constructor(private readonly config: Config) {
    const toolDisplayName = 'Todo Manager';
    const toolDescription = `Manage a TODO list to track AI progress and task completion.

This tool allows the AI to:
- Create new TODO items for tasks to be completed
- Update existing TODO items with progress status
- Mark tasks as in_progress, completed, or cancelled
- Set priority levels (high, medium, low)
- Create hierarchical subtasks
- List all current todos with their status
- Clear completed tasks

Status meanings:
- pending: Task not yet started
- in_progress: Currently working on (should only have one at a time)
- completed: Task finished successfully
- cancelled: Task no longer needed or abandoned

The TODO list is displayed in the chat interface to show real-time progress to the user.`;

    const toolParameterSchema = {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete', 'list', 'clear'],
          description: 'Action to perform on the TODO list'
        },
        todoId: {
          type: 'string',
          description: 'ID of the TODO item to update or delete'
        },
        content: {
          type: 'string',
          description: 'Content/description of the TODO item'
        },
        status: {
          type: 'string',
          enum: ['pending', 'in_progress', 'completed', 'cancelled'],
          description: 'Status of the TODO item'
        },
        priority: {
          type: 'string',
          enum: ['high', 'medium', 'low'],
          description: 'Priority level of the TODO item'
        },
        parentId: {
          type: 'string',
          description: 'Parent TODO ID for creating subtasks'
        },
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
              parentId: { type: 'string' }
            }
          },
          description: 'Array of TODO items for bulk operations'
        }
      },
      required: ['action']
    };

    super(
      TodoManagerTool.Name,
      toolDisplayName,
      toolDescription,
      toolParameterSchema,
      true, // output is markdown
      false, // output cannot be updated
    );
  }

  getDescription(params: TodoManagerParams): string {
    switch (params.action) {
      case 'create':
        return `Create TODO: "${params.content}" (${params.priority || 'medium'} priority)`;
      case 'update':
        return `Update TODO ${params.todoId}: ${params.status ? `status → ${params.status}` : 'modify'}`;
      case 'delete':
        return `Delete TODO: ${params.todoId}`;
      case 'list':
        return 'List all TODO items';
      case 'clear':
        return 'Clear completed TODO items';
      default:
        return `TODO ${params.action}`;
    }
  }

  validateToolParams(params: TodoManagerParams): string | null {
    if (!SchemaValidator.validate(this.parameterSchema as Record<string, unknown>, params)) {
      return 'Invalid parameters for TODO manager';
    }

    switch (params.action) {
      case 'create':
        if (!params.content) {
          return 'Create action requires content';
        }
        break;
      case 'update':
      case 'delete':
        if (!params.todoId) {
          return `${params.action} action requires todoId`;
        }
        break;
      case 'list':
      case 'clear':
        // No additional validation needed
        break;
      default:
        return `Unknown action: ${params.action}`;
    }

    return null;
  }

  async shouldConfirmExecute(
    _params: TodoManagerParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // TODO management doesn't require confirmation
    return false;
  }

  async execute(params: TodoManagerParams, _signal: AbortSignal): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: ${validationError}`,
        returnDisplay: `## TODO Manager Error\n\n${validationError}`,
      };
    }

    try {
      switch (params.action) {
        case 'create':
          return this.createTodo(params);
        case 'update':
          return this.updateTodo(params);
        case 'delete':
          return this.deleteTodo(params);
        case 'list':
          return this.listTodos();
        case 'clear':
          return this.clearCompleted();
        default:
          return {
            llmContent: `Unknown action: ${params.action}`,
            returnDisplay: `## TODO Manager Error\n\nUnknown action: ${params.action}`,
          };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `TODO manager error: ${errorMessage}`,
        returnDisplay: `## TODO Manager Error\n\n${errorMessage}`,
      };
    }
  }

  private createTodo(params: TodoManagerParams): ToolResult {
    const id = params.todoId || this.generateId();
    const now = new Date();
    
    const todo: TodoItem = {
      id,
      content: params.content!,
      status: params.status || 'pending',
      priority: params.priority || 'medium',
      createdAt: now,
      updatedAt: now,
      parentId: params.parentId,
    };

    this.todos.set(id, todo);

    // If setting as in_progress, clear other in_progress todos
    if (todo.status === 'in_progress') {
      this.clearOtherInProgress(id);
      this.currentTodoId = id;
    }

    return {
      llmContent: `Created TODO: ${todo.content} (${todo.priority} priority, ${todo.status})`,
      returnDisplay: this.formatTodoDisplay('create', todo),
    };
  }

  private updateTodo(params: TodoManagerParams): ToolResult {
    const todo = this.todos.get(params.todoId!);
    if (!todo) {
      return {
        llmContent: `TODO not found: ${params.todoId}`,
        returnDisplay: `## TODO Not Found\n\nTODO with ID ${params.todoId} not found.`,
      };
    }

    const oldStatus = todo.status;
    
    if (params.content) todo.content = params.content;
    if (params.status) todo.status = params.status;
    if (params.priority) todo.priority = params.priority;
    todo.updatedAt = new Date();

    // Handle status changes
    if (params.status && params.status !== oldStatus) {
      if (params.status === 'in_progress') {
        this.clearOtherInProgress(params.todoId!);
        this.currentTodoId = params.todoId!;
      } else if (oldStatus === 'in_progress') {
        this.currentTodoId = null;
      }
    }

    return {
      llmContent: `Updated TODO: ${todo.content} (${todo.status})`,
      returnDisplay: this.formatTodoDisplay('update', todo),
    };
  }

  private deleteTodo(params: TodoManagerParams): ToolResult {
    const todo = this.todos.get(params.todoId!);
    if (!todo) {
      return {
        llmContent: `TODO not found: ${params.todoId}`,
        returnDisplay: `## TODO Not Found\n\nTODO with ID ${params.todoId} not found.`,
      };
    }

    this.todos.delete(params.todoId!);
    
    if (this.currentTodoId === params.todoId) {
      this.currentTodoId = null;
    }

    return {
      llmContent: `Deleted TODO: ${todo.content}`,
      returnDisplay: `## TODO Deleted\n\n~~${todo.content}~~`,
    };
  }

  private listTodos(): ToolResult {
    const todoList = Array.from(this.todos.values())
      .sort((a, b) => {
        // Sort by priority (high first), then by creation date
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });

    if (todoList.length === 0) {
      return {
        llmContent: 'No TODO items found.',
        returnDisplay: '## TODO List\n\nNo items in the TODO list.',
      };
    }

    const llmContent = todoList.map(todo => 
      `- [${todo.status === 'completed' ? 'x' : ' '}] ${todo.content} (${todo.priority}, ${todo.status})`
    ).join('\n');

    return {
      llmContent: `TODO List (${todoList.length} items):\n${llmContent}`,
      returnDisplay: this.formatTodoListDisplay(todoList),
    };
  }

  private clearCompleted(): ToolResult {
    const completedTodos = Array.from(this.todos.values())
      .filter(todo => todo.status === 'completed');
    
    completedTodos.forEach(todo => this.todos.delete(todo.id));

    return {
      llmContent: `Cleared ${completedTodos.length} completed TODO items.`,
      returnDisplay: `## TODO Cleanup\n\nCleared ${completedTodos.length} completed items.`,
    };
  }

  private clearOtherInProgress(exceptId: string): void {
    for (const [id, todo] of this.todos) {
      if (id !== exceptId && todo.status === 'in_progress') {
        todo.status = 'pending';
        todo.updatedAt = new Date();
      }
    }
  }

  private generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  private formatTodoDisplay(action: string, todo: TodoItem): string {
    const statusIcon = this.getStatusIcon(todo.status);
    const priorityColor = this.getPriorityColor(todo.priority);
    
    return `## TODO ${action.toUpperCase()}\n\n${statusIcon} **${todo.content}** (${priorityColor}${todo.priority}, ${todo.status})`;
  }

  private formatTodoListDisplay(todos: TodoItem[]): string {
    let display = '## ⏺ TODO Progress\n\n';
    
    todos.forEach((todo, index) => {
      const statusIcon = this.getStatusIcon(todo.status);
      const indent = todo.parentId ? '   ' : '';
      const isLast = index === todos.length - 1;
      const connector = isLast ? '⎿' : '⎿';
      
      display += `${indent}${connector} ${statusIcon} ${todo.content}\n`;
    });

    return display;
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'completed':
        return '☒';
      case 'in_progress':
        return '🔄';
      case 'cancelled':
        return '❌';
      default:
        return '☐';
    }
  }

  private getPriorityColor(priority: string): string {
    switch (priority) {
      case 'high':
        return '🔴 ';
      case 'medium':
        return '🟡 ';
      case 'low':
        return '🟢 ';
      default:
        return '';
    }
  }

  // Public method to get current todos for UI display
  public getTodos(): TodoItem[] {
    return Array.from(this.todos.values());
  }

  // Public method to get current active todo
  public getCurrentTodo(): TodoItem | null {
    return this.currentTodoId ? this.todos.get(this.currentTodoId) || null : null;
  }
}