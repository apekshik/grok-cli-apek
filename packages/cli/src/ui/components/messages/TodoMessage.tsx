/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';
import { TodoItem } from '../../types.js';
import { TodoDisplay } from '../TodoDisplay.js';

interface TodoMessageProps {
  todos: TodoItem[];
  currentTodoId?: string;
}

export const TodoMessage: React.FC<TodoMessageProps> = ({ todos, currentTodoId }) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <TodoDisplay todos={todos} currentTodoId={currentTodoId} />
    </Box>
  );
};