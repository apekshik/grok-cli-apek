/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

type Model = string;
type TokenCount = number;

export const DEFAULT_TOKEN_LIMIT = 1_048_576;

export function tokenLimit(model: Model): TokenCount {
  // Add other models as they become relevant or if specified by config
  // Pulled from https://ai.google.dev/gemini-api/docs/models and https://docs.x.ai/docs/models
  switch (model) {
    case 'gemini-1.5-pro':
      return 2_097_152;
    case 'gemini-1.5-flash':
    case 'gemini-2.5-pro-preview-05-06':
    case 'gemini-2.5-pro-preview-06-05':
    case 'gemini-2.5-pro':
    case 'gemini-2.5-flash-preview-05-20':
    case 'gemini-2.5-flash':
    case 'gemini-2.0-flash':
      return 1_048_576;
    case 'gemini-2.0-flash-preview-image-generation':
      return 32_000;
    // Grok models from xAI
    case 'grok-3-latest':
    case 'grok-3-mini-latest':
    case 'grok-beta':
      return 131_072; // 131K tokens as per xAI documentation
    case 'grok-4-latest':
    case 'grok-4-mini-latest':
      return 131_072; // 131K tokens - using same as Grok 3 until xAI updates docs
    default:
      return DEFAULT_TOKEN_LIMIT;
  }
}
