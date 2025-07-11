/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_MODEL = 'grok-3-latest';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// Grok models with reasoning support
export const GROK_4_MODEL = 'grok-4-latest'; // Supports reasoning AND returns reasoning_content
export const GROK_4_MINI_MODEL = 'grok-4-mini-latest'; // Supports reasoning AND returns reasoning_content

// Legacy Grok models (no reasoning support)
export const GROK_3_MODEL = 'grok-3-latest'; // No reasoning support
export const GROK_3_FAST_MODEL = 'grok-3-fast'; // No reasoning support

// Grok mini models with reasoning support and reasoning_content
export const GROK_3_MINI_MODEL = 'grok-3-mini-latest'; // Supports reasoning AND returns reasoning_content
export const GROK_3_MINI_FAST_MODEL = 'grok-3-mini-fast'; // Supports reasoning AND returns reasoning_content
