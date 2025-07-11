/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback } from 'react';
import { TodoItem } from '../types.js';

export interface UseTodoManagerReturn {
  todos: TodoItem[];
  currentTodoId: string | null;
  addTodo: (todo: Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>) => string;
  updateTodo: (id: string, updates: Partial<Omit<TodoItem, 'id'>>) => void;
  deleteTodo: (id: string) => void;
  clearCompleted: () => void;
  setCurrentTodo: (id: string | null) => void;
  getTodoById: (id: string) => TodoItem | undefined;
}

/**
 * Custom hook to manage TODO state in the CLI application.
 * Handles TODO creation, updates, deletion, and status management.
 */
export function useTodoManager(): UseTodoManagerReturn {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [currentTodoId, setCurrentTodoId] = useState<string | null>(null);

  const generateId = useCallback((): string => 
    Date.now().toString(36) + Math.random().toString(36).substr(2), []);

  const addTodo = useCallback((todoData: Omit<TodoItem, 'id' | 'createdAt' | 'updatedAt'>): string => {
    const id = generateId();
    const now = new Date();
    const newTodo: TodoItem = {
      ...todoData,
      id,
      createdAt: now,
      updatedAt: now,
    };

    setTodos(prev => [...prev, newTodo]);

    // If setting as in_progress, clear other in_progress todos
    if (newTodo.status === 'in_progress') {
      setTodos(prev => prev.map(todo => 
        todo.id !== id && todo.status === 'in_progress' 
          ? { ...todo, status: 'pending', updatedAt: now }
          : todo
      ));
      setCurrentTodoId(id);
    }

    return id;
  }, [generateId]);

  const updateTodo = useCallback((id: string, updates: Partial<Omit<TodoItem, 'id'>>) => {
    const now = new Date();
    
    setTodos(prev => prev.map(todo => {
      if (todo.id !== id) return todo;
      
      const updatedTodo = { ...todo, ...updates, updatedAt: now };
      
      // Handle status changes
      if (updates.status && updates.status !== todo.status) {
        if (updates.status === 'in_progress') {
          // Clear other in_progress todos
          setTodos(prevInner => prevInner.map(t => 
            t.id !== id && t.status === 'in_progress' 
              ? { ...t, status: 'pending', updatedAt: now }
              : t
          ));
          setCurrentTodoId(id);
        } else if (todo.status === 'in_progress') {
          setCurrentTodoId(null);
        }
      }
      
      return updatedTodo;
    }));
  }, []);

  const deleteTodo = useCallback((id: string) => {
    setTodos(prev => prev.filter(todo => todo.id !== id));
    if (currentTodoId === id) {
      setCurrentTodoId(null);
    }
  }, [currentTodoId]);

  const clearCompleted = useCallback(() => {
    setTodos(prev => prev.filter(todo => todo.status !== 'completed'));
  }, []);

  const getTodoById = useCallback((id: string): TodoItem | undefined => 
    todos.find(todo => todo.id === id), [todos]);

  return {
    todos,
    currentTodoId,
    addTodo,
    updateTodo,
    deleteTodo,
    clearCompleted,
    setCurrentTodo: setCurrentTodoId,
    getTodoById,
  };
}