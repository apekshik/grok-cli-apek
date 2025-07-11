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
            content,
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
      console.log('DEBUG: Adding tools to Grok request:', JSON.stringify(tools, null, 2));
      openaiRequest.tools = tools;
      openaiRequest.tool_choice = 'auto';
    }

    console.log('DEBUG: Final Grok API request:', JSON.stringify({ 
      model: openaiRequest.model, 
      messages: openaiRequest.messages, 
      tools: openaiRequest.tools?.length || 0,
      tool_choice: openaiRequest.tool_choice 
    }, null, 2));

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
    let cleanedTextContent = message.content || '';

    // Debug logging to understand the response format
    console.log('DEBUG: Raw grok response content:', JSON.stringify(message.content, null, 2));
    console.log('DEBUG: Tool calls:', JSON.stringify(message.tool_calls, null, 2));

    // Parse custom function call format from grok-mini
    if (message.content && message.content.includes('[function_call]')) {
      const functionCallMatches = message.content.matchAll(/\[function_call\](.*?)\[\/function_call\]/gs);
      
      for (const match of functionCallMatches) {
        try {
          const functionCallData = JSON.parse(match[1].trim());
          const functionCall = {
            id: `grok_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: functionCallData.action,
            args: functionCallData.action_input || {},
          };
          parts.push({ functionCall });
          functionCalls.push(functionCall);
        } catch (error) {
          console.warn('Failed to parse function call from grok response:', error);
        }
      }
      
      // Remove function call blocks from text content
      cleanedTextContent = message.content.replace(/\[function_call\].*?\[\/function_call\]/gs, '').trim();
    }

    // Check for Grok Mini "[tool_call: func_name for param_name 'value']" pattern
    if (message.content && message.content.includes('[tool_call:')) {
      const toolCallMatches = message.content.matchAll(/\[tool_call:\s*(\w+)\s+for\s+(\w+)\s+['"]([^'"]+)['"]\]/g);
      
      for (const match of toolCallMatches) {
        const functionName = match[1];
        const paramName = match[2];
        const paramValue = match[3];
        const functionCall = {
          id: `grok_mini_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: functionName,
          args: { [paramName]: paramValue },
        };
        parts.push({ functionCall });
        functionCalls.push(functionCall);
      }
      
      // Remove tool call text
      cleanedTextContent = message.content.replace(/\s*\[tool_call:[^\]]+\]\s*/g, '').trim();
    }

    // Check for simple "Calling function X" pattern
    if (message.content && message.content.includes('Calling function ')) {
      const simpleCallMatches = message.content.matchAll(/Calling function (\w+)/g);
      
      for (const match of simpleCallMatches) {
        const functionName = match[1];
        const functionCall = {
          id: `grok_simple_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          name: functionName,
          args: {},
        };
        parts.push({ functionCall });
        functionCalls.push(functionCall);
      }
      
      // Remove simple function call text
      cleanedTextContent = message.content.replace(/\s*Calling function \w+\s*/g, '').trim();
    }

    // Add cleaned text content if it exists
    if (cleanedTextContent) {
      parts.push({ text: cleanedTextContent });
    }

    // Convert standard OpenAI tool calls to function calls
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
      text: cleanedTextContent,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      data: undefined,
      executableCode: undefined,
      codeExecutionResult: undefined,
    } as GenerateContentResponse;
  }

  private async *convertStreamToGeminiFormat(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  ): AsyncGenerator<GenerateContentResponse> {
    let accumulatedContent = '';
    
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;
      const parts: Part[] = [];
      const functionCalls: any[] = [];
      let cleanedTextContent = delta.content || '';

      // Handle reasoning content for supported models (grok-3-mini-latest, etc.)
      if ((delta as any).reasoning_content) {
        const reasoningText = (delta as any).reasoning_content;
        // Convert reasoning content to thought format
        const thoughtPart = {
          thought: true,
          text: `**Thinking** ${reasoningText}`,
        };
        parts.push(thoughtPart);
      }

      // Accumulate content to detect complete function calls
      if (delta.content) {
        accumulatedContent += delta.content;
        
        // Note: All current Grok models (including Grok 4) return reasoning_content
        // via the API, so no client-side pattern detection is needed
      }

      // Check for complete function call blocks in accumulated content
      if (accumulatedContent.includes('[function_call]') && accumulatedContent.includes('[/function_call]')) {
        const functionCallMatches = accumulatedContent.matchAll(/\[function_call\](.*?)\[\/function_call\]/gs);
        
        for (const match of functionCallMatches) {
          try {
            const functionCallData = JSON.parse(match[1].trim());
            const functionCall = {
              id: `grok_stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              name: functionCallData.action,
              args: functionCallData.action_input || {},
            };
            parts.push({ functionCall });
            functionCalls.push(functionCall);
          } catch (error) {
            console.warn('Failed to parse function call from grok stream:', error);
          }
        }
        
        // Remove processed function call blocks and update content
        const cleanedAccumulated = accumulatedContent.replace(/\[function_call\].*?\[\/function_call\]/gs, '').trim();
        accumulatedContent = cleanedAccumulated;
        cleanedTextContent = (delta.content || '').replace(/\[function_call\].*?\[\/function_call\]/gs, '').trim();
      }

      // Check for complete Grok Mini tool call pattern in accumulated content
      if (accumulatedContent.includes('[tool_call:')) {
        const toolCallMatches = accumulatedContent.matchAll(/\[tool_call:\s*(\w+)\s+for\s+(\w+)\s+['"]([^'"]+)['"]\]/g);
        
        for (const match of toolCallMatches) {
          const functionName = match[1];
          const paramName = match[2];
          const paramValue = match[3];
          const functionCall = {
            id: `grok_mini_stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            name: functionName,
            args: { [paramName]: paramValue },
          };
          parts.push({ functionCall });
          functionCalls.push(functionCall);
        }
        
        // Remove processed tool call blocks and update content
        const cleanedAccumulated = accumulatedContent.replace(/\s*\[tool_call:[^\]]+\]\s*/g, '').trim();
        accumulatedContent = cleanedAccumulated;
        cleanedTextContent = (delta.content || '').replace(/\s*\[tool_call:[^\]]+\]\s*/g, '').trim();
      }

      // Add cleaned text content if it exists
      if (cleanedTextContent) {
        parts.push({ text: cleanedTextContent });
      }

      // Convert standard OpenAI tool calls
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
          text: cleanedTextContent,
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

  async embedContent(_request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // Grok doesn't support embeddings currently
    throw new Error('Embeddings not supported by Grok');
  }
}

export function createGrokContentGenerator(
  config: ContentGeneratorConfig,
): ContentGenerator {
  return new GrokContentGenerator(config);
}