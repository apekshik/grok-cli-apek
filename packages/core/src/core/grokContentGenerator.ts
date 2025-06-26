/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import OpenAI from 'openai';
import {
  CountTokensResponse,
  GenerateContentResponse,
  GenerateContentParameters,
  CountTokensParameters,
  EmbedContentResponse,
  EmbedContentParameters,
  Content,
  Part,
  GenerateContentConfig,
  FinishReason,
} from '@google/genai';
import { ContentGenerator, ContentGeneratorConfig } from './contentGenerator.js';

export class GrokContentGenerator implements ContentGenerator {
  private client: OpenAI;

  constructor(config: ContentGeneratorConfig) {
    this.client = new OpenAI({
      baseURL: 'https://api.x.ai/v1',
      apiKey: config.apiKey,
    });
  }

  async generateContent(
    request: GenerateContentParameters,
  ): Promise<GenerateContentResponse> {
    // Convert Gemini request format to OpenAI format
    const openaiRequest = this.convertToOpenAIRequest(request);
    
    const response = await this.client.chat.completions.create(openaiRequest) as OpenAI.Chat.Completions.ChatCompletion;
    
    // Convert OpenAI response back to Gemini format
    return this.convertToGeminiResponse(response);
  }

  async generateContentStream(
    request: GenerateContentParameters,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const openaiRequest = {
      ...this.convertToOpenAIRequest(request),
      stream: true,
    };
    
    const stream = await this.client.chat.completions.create(openaiRequest) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    
    return this.convertStreamToGeminiFormat(stream);
  }

  private convertToOpenAIRequest(request: GenerateContentParameters): OpenAI.Chat.Completions.ChatCompletionCreateParams {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    
    // Convert Gemini contents to OpenAI messages
    if (request.contents) {
      const contentArray = Array.isArray(request.contents) ? request.contents : [request.contents];
      for (const content of contentArray) {
        if (typeof content === 'string') {
          messages.push({
            role: 'user',
            content: content,
          });
        } else if (this.isContent(content)) {
          if (content.role === 'user') {
            const textContent = this.extractTextFromParts(content.parts || []);
            messages.push({
              role: 'user',
              content: textContent,
            });
          } else if (content.role === 'model') {
            const textContent = this.extractTextFromParts(content.parts || []);
            if (textContent) {
              messages.push({
                role: 'assistant',
                content: textContent,
              });
            }
          }
        }
      }
    }

    const openaiRequest: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
      model: request.model || 'grok-beta',
      messages,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
      top_p: request.config?.topP,
    };

    // Add system instruction if present
    if (request.config?.systemInstruction) {
      if (typeof request.config.systemInstruction === 'string') {
        messages.unshift({
          role: 'system',
          content: request.config.systemInstruction,
        });
      } else if (this.isContent(request.config.systemInstruction) && request.config.systemInstruction.parts) {
        const systemContent = this.extractTextFromParts(request.config.systemInstruction.parts);
        if (systemContent) {
          messages.unshift({
            role: 'system',
            content: systemContent,
          });
        }
      }
    }

    // Add tools if present
    if (request.config?.tools && request.config.tools.length > 0) {
      const tools = this.convertToolsToOpenAIFormat(request.config.tools);
      openaiRequest.tools = tools;
      openaiRequest.tool_choice = 'auto';
    }

    return openaiRequest;
  }

  private convertToolsToOpenAIFormat(geminiTools: any[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const openaiTools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

    for (const tool of geminiTools) {
      if (tool.functionDeclarations) {
        for (const func of tool.functionDeclarations) {
          openaiTools.push({
            type: 'function',
            function: {
              name: func.name,
              description: func.description,
              parameters: func.parameters,
            },
          });
        }
      }
    }

    return openaiTools;
  }

  private isContent(obj: any): obj is Content {
    return obj && typeof obj === 'object' && 'role' in obj && 'parts' in obj;
  }

  private extractTextFromParts(parts: Part[]): string {
    return parts
      .map(part => {
        if (part.text) return part.text;
        if (part.functionResponse) return `Function ${part.functionResponse.name} executed`;
        if (part.functionCall) return `Calling function ${part.functionCall.name}`;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }

  private convertToGeminiResponse(response: OpenAI.Chat.Completions.ChatCompletion): GenerateContentResponse {
    const choice = response.choices[0];
    const message = choice.message;

    const parts: Part[] = [];
    const functionCalls: any[] = [];

    // Add text content
    if (message.content) {
      parts.push({ text: message.content });
    }

    // Convert tool calls to function calls
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === 'function') {
          const functionCall = {
            id: toolCall.id,
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}'),
          };
          parts.push({ functionCall });
          functionCalls.push(functionCall);
        }
      }
    }

    const textContent = message.content || '';

    return {
      candidates: [
        {
          content: {
            role: 'model',
            parts,
          },
          finishReason: choice.finish_reason === 'stop' ? FinishReason.STOP : FinishReason.OTHER,
        },
      ],
      usageMetadata: response.usage
        ? {
            promptTokenCount: response.usage.prompt_tokens,
            candidatesTokenCount: response.usage.completion_tokens,
            totalTokenCount: response.usage.total_tokens,
          }
        : undefined,
      // Add the expected top-level properties
      text: textContent,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      data: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    } as GenerateContentResponse;
  }

  private async *convertStreamToGeminiFormat(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  ): AsyncGenerator<GenerateContentResponse> {
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;
      const parts: Part[] = [];
      const functionCalls: any[] = [];

      // Add text content
      if (delta.content) {
        parts.push({ text: delta.content });
      }

      // Convert tool calls
      if (delta.tool_calls) {
        for (const toolCall of delta.tool_calls) {
          if (toolCall.type === 'function' && toolCall.function) {
            const functionCall = {
              id: toolCall.id || `tool_${Date.now()}`,
              name: toolCall.function.name || '',
              args: toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {},
            };
            parts.push({ functionCall });
            functionCalls.push(functionCall);
          }
        }
      }

      if (parts.length > 0) {
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts,
              },
              finishReason: choice.finish_reason === 'stop' ? FinishReason.STOP : FinishReason.OTHER,
            },
          ],
          // Add the expected top-level properties
          text: delta.content || '',
          functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
          data: undefined,
          executableCode: undefined,
          codeExecutionResult: undefined,
        } as GenerateContentResponse;
      }
    }
  }

  // Placeholder implementations (may not be needed for Grok)
  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // Grok doesn't have a token counting endpoint, return estimate
    if (!request.contents) {
      return { totalTokens: 0 };
    }

    const contentArray = Array.isArray(request.contents) ? request.contents : [request.contents];
    const textContent = contentArray
      .map(content => {
        if (typeof content === 'string') {
          return content;
        }
        if (this.isContent(content)) {
          return this.extractTextFromParts(content.parts || []);
        }
        return '';
      })
      .join(' ');
    
    // Rough estimate: ~4 characters per token
    const estimatedTokens = Math.ceil(textContent.length / 4);
    
    return { totalTokens: estimatedTokens };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // Grok doesn't support embeddings currently
    throw new Error('Embeddings not supported by Grok');
  }
}

export function createGrokContentGenerator(
  config: ContentGeneratorConfig,
): ContentGenerator {
  return new GrokContentGenerator(config);
}