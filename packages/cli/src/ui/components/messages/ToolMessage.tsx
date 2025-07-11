/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';

const STATIC_HEIGHT = 1;
const RESERVED_LINE_COUNT = 5; // for tool name, status, padding etc.
const MIN_LINES_SHOWN = 2; // show at least this many lines

// Large threshold to ensure we don't cause performance issues for very large
// outputs that will get truncated further MaxSizedBox anyway.
const MAXIMUM_RESULT_DISPLAY_CHARACTERS = 1000000;
export type TextEmphasis = 'high' | 'medium' | 'low';

export interface ToolMessageProps extends IndividualToolCallDisplay {
  availableTerminalHeight?: number;
  terminalWidth: number;
  emphasis?: TextEmphasis;
  renderOutputAsMarkdown?: boolean;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  name,
  description,
  resultDisplay,
  status,
  availableTerminalHeight,
  terminalWidth,
  emphasis = 'medium',
  renderOutputAsMarkdown = true,
}) => {
  const availableHeight = availableTerminalHeight
    ? Math.max(
        availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT,
        MIN_LINES_SHOWN + 1, // enforce minimum lines shown
      )
    : undefined;

  // Long tool call response in MarkdownDisplay doesn't repect availableTerminalHeight properly,
  // we're forcing it to not render as markdown when the response is too long, it will fallback
  // to render as plain text, which is contained within the terminal using MaxSizedBox
  if (availableHeight) {
    renderOutputAsMarkdown = false;
  }

  const childWidth = terminalWidth - 3; // account for padding.
  if (typeof resultDisplay === 'string') {
    if (resultDisplay.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
      // Truncate the result display to fit within the available width.
      resultDisplay =
        '...' + resultDisplay.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
    }
  }
  return (
    <Box paddingX={0} paddingY={0} flexDirection="column">
      <Box minHeight={1}>
        <ToolStatusIndicator status={status} />
        <Text color={Colors.Foreground}> </Text>
        <ToolInfo
          name={name}
          status={status}
          description={description}
          emphasis={emphasis}
        />
      </Box>
      {resultDisplay && (
        <Box paddingLeft={2} width="100%">
          <Text color={Colors.Foreground}>⎿  </Text>
          <Box flexDirection="column" flexGrow={1}>
            {typeof resultDisplay === 'string' && renderOutputAsMarkdown && (
              <Box flexDirection="column">
                <MarkdownDisplay
                  text={resultDisplay}
                  isPending={false}
                  availableTerminalHeight={availableHeight}
                  terminalWidth={childWidth - 4}
                />
              </Box>
            )}
            {typeof resultDisplay === 'string' && !renderOutputAsMarkdown && (
              <MaxSizedBox maxHeight={availableHeight} maxWidth={childWidth - 4}>
                <Box>
                  <Text wrap="wrap">{resultDisplay}</Text>
                </Box>
              </MaxSizedBox>
            )}
            {typeof resultDisplay !== 'string' && (
              <DiffRenderer
                diffContent={resultDisplay.fileDiff}
                filename={resultDisplay.fileName}
                availableTerminalHeight={availableHeight}
                terminalWidth={childWidth - 4}
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

type ToolStatusIndicatorProps = {
  status: ToolCallStatus;
};

const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({
  status,
}) => (
  <Text color={Colors.Foreground}>
    {status === ToolCallStatus.Pending && '⏺'}
    {status === ToolCallStatus.Executing && '⏺'}
    {status === ToolCallStatus.Success && '⏺'}
    {status === ToolCallStatus.Confirming && '⏺'}
    {status === ToolCallStatus.Canceled && '⏺'}
    {status === ToolCallStatus.Error && '⏺'}
  </Text>
);

type ToolInfo = {
  name: string;
  description: string;
  status: ToolCallStatus;
  emphasis: TextEmphasis;
};
const ToolInfo: React.FC<ToolInfo> = ({
  name,
  description,
  status,
  emphasis,
}) => {
  const nameColor = React.useMemo<string>(() => {
    switch (emphasis) {
      case 'high':
        return Colors.Foreground;
      case 'medium':
        return Colors.Foreground;
      case 'low':
        return Colors.Gray;
      default: {
        const exhaustiveCheck: never = emphasis;
        return exhaustiveCheck;
      }
    }
  }, [emphasis]);
  return (
    <Box>
      <Text
        wrap="truncate-end"
        strikethrough={status === ToolCallStatus.Canceled}
      >
        <Text color={nameColor} bold>
          {name}
        </Text>
        <Text color={Colors.Gray}>({description})</Text>
      </Text>
    </Box>
  );
};

