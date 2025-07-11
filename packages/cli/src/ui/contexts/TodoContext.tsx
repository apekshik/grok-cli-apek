/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, ReactNode } from 'react';
import { useTodoManager, UseTodoManagerReturn } from '../hooks/useTodoManager.js';

const TodoContext = createContext<UseTodoManagerReturn | undefined>(undefined);

interface TodoProviderProps {
  children: ReactNode;
}

export const TodoProvider: React.FC<TodoProviderProps> = ({ children }) => {
  const todoManager = useTodoManager();
  return (
    <TodoContext.Provider value={todoManager}>
      {children}
    </TodoContext.Provider>
  );
};

export const useTodoContext = (): UseTodoManagerReturn => {
  const context = useContext(TodoContext);
  if (!context) {
    throw new Error('useTodoContext must be used within a TodoProvider');
  }
  return context;
};