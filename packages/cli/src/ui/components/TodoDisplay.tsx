/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { TodoItem } from '../types.js';

interface TodoDisplayProps {
  todos: TodoItem[];
  currentTodoId?: string;
}

export const TodoDisplay: React.FC<TodoDisplayProps> = ({ todos, currentTodoId }) => {
  if (todos.length === 0) {
    return null;
  }

  // Sort todos by priority and creation date
  const sortedTodos = [...todos].sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  // Filter out cancelled todos for display
  const activeTodos = sortedTodos.filter(todo => todo.status !== 'cancelled');

  if (activeTodos.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Box flexDirection="row" alignItems="center">
        <Text color={Colors.AccentPurple} bold>⏺ TODO Progress</Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {activeTodos.map((todo, index) => (
          <TodoItem 
            key={todo.id} 
            todo={todo} 
            isLast={index === activeTodos.length - 1}
            isCurrent={todo.id === currentTodoId}
          />
        ))}
      </Box>
    </Box>
  );
};

interface TodoItemProps {
  todo: TodoItem;
  isLast: boolean;
  isCurrent: boolean;
}

const TodoItem: React.FC<TodoItemProps> = ({ todo, isLast, isCurrent }) => {
  const connector = isLast ? '⎿' : '⎿';
  const statusIcon = getStatusIcon(todo.status);
  
  // Color coding based on status
  let textColor = Colors.Foreground;
  let textDecoration = '';
  
  if (todo.status === 'completed') {
    textColor = Colors.AccentGreen;
    textDecoration = 'strikethrough';
  } else if (todo.status === 'in_progress' || isCurrent) {
    textColor = Colors.AccentBlue;
  } else if (todo.priority === 'high') {
    textColor = Colors.Foreground;
  }

  return (
    <Box flexDirection="row" alignItems="center">
      <Text color={Colors.Foreground}>{connector} </Text>
      <Text color={getPriorityColorCode(todo.priority)}>{statusIcon}</Text>
      <Text color={textColor} strikethrough={textDecoration === 'strikethrough'}>
        {' '}{todo.content}
      </Text>
      {todo.priority === 'high' && todo.status !== 'completed' && (
        <Text color={Colors.AccentRed}> ⚠️</Text>
      )}
    </Box>
  );
};

function getStatusIcon(status: string): string {
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


function getPriorityColorCode(priority: string): string {
  switch (priority) {
    case 'high':
      return Colors.AccentRed;
    case 'medium':
      return Colors.AccentYellow;
    case 'low':
      return Colors.AccentGreen;
    default:
      return Colors.Foreground;
  }
}