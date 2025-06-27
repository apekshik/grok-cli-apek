/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseTool, ToolResult } from './tools.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { getErrorMessage } from '../utils/errors.js';
import * as path from 'path';
import { glob } from 'glob';
import { getCurrentGeminiMdFilename } from './memoryTool.js';
import {
  detectFileType,
  processSingleFileContent,
  DEFAULT_ENCODING,
  getSpecificMimeType,
} from '../utils/fileUtils.js';
import { PartListUnion } from '@google/genai';
import { Config } from '../config/config.js';
import {
  recordFileOperationMetric,
  FileOperation,
} from '../telemetry/metrics.js';
import { tokenLimit } from '../core/tokenLimits.js';
import { getResponseText } from '../utils/generateContentResponseUtilities.js';

/**
 * Parameters for the ReadManyFilesTool.
 */
export interface ReadManyFilesParams {
  /**
   * An array of file paths or directory paths to search within.
   * Paths are relative to the tool's configured target directory.
   * Glob patterns can be used directly in these paths.
   */
  paths: string[];

  /**
   * Optional. Glob patterns for files to include.
   * These are effectively combined with the `paths`.
   * Example: ["*.ts", "src/** /*.md"]
   */
  include?: string[];

  /**
   * Optional. Glob patterns for files/directories to exclude.
   * Applied as ignore patterns.
   * Example: ["*.log", "dist/**"]
   */
  exclude?: string[];

  /**
   * Optional. Search directories recursively.
   * This is generally controlled by glob patterns (e.g., `**`).
   * The glob implementation is recursive by default for `**`.
   * For simplicity, we'll rely on `**` for recursion.
   */
  recursive?: boolean;

  /**
   * Optional. Apply default exclusion patterns. Defaults to true.
   */
  useDefaultExcludes?: boolean;

  /**
   * Optional. Whether to respect .gitignore patterns. Defaults to true.
   */
  respect_git_ignore?: boolean;
}

/**
 * Default exclusion patterns for commonly ignored directories and binary file types.
 * These are compatible with glob ignore patterns.
 * TODO(adh): Consider making this configurable or extendable through a command line arguement.
 * TODO(adh): Look into sharing this list with the glob tool.
 */
const DEFAULT_EXCLUDES: string[] = [
  '**/node_modules/**',
  '**/.git/**',
  '**/.vscode/**',
  '**/.idea/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.pyo',
  '**/*.bin',
  '**/*.exe',
  '**/*.dll',
  '**/*.so',
  '**/*.dylib',
  '**/*.class',
  '**/*.jar',
  '**/*.war',
  '**/*.zip',
  '**/*.tar',
  '**/*.gz',
  '**/*.bz2',
  '**/*.rar',
  '**/*.7z',
  '**/*.doc',
  '**/*.docx',
  '**/*.xls',
  '**/*.xlsx',
  '**/*.ppt',
  '**/*.pptx',
  '**/*.odt',
  '**/*.ods',
  '**/*.odp',
  '**/*.DS_Store',
  '**/.env',
  `**/${getCurrentGeminiMdFilename()}`,
];

const DEFAULT_OUTPUT_SEPARATOR_FORMAT = '--- {filePath} ---';

/**
 * Tool implementation for finding and reading multiple text files from the local filesystem
 * within a specified target directory. The content is concatenated.
 * It is intended to run in an environment with access to the local file system (e.g., a Node.js backend).
 */
export class ReadManyFilesTool extends BaseTool<
  ReadManyFilesParams,
  ToolResult
> {
  static readonly Name: string = 'read_many_files';
  private readonly geminiIgnorePatterns: string[] = [];

  /**
   * Creates an instance of ReadManyFilesTool.
   * @param targetDir The absolute root directory within which this tool is allowed to operate.
   * All paths provided in `params` will be resolved relative to this directory.
   */
  constructor(
    readonly targetDir: string,
    private config: Config,
  ) {
    const parameterSchema: Record<string, unknown> = {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description:
            "Required. An array of glob patterns or paths relative to the tool's target directory. Examples: ['src/**/*.ts'], ['README.md', 'docs/']",
        },
        include: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Additional glob patterns to include. These are merged with `paths`. Example: ["*.test.ts"] to specifically add test files if they were broadly excluded.',
          default: [],
        },
        exclude: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional. Glob patterns for files/directories to exclude. Added to default excludes if useDefaultExcludes is true. Example: ["**/*.log", "temp/"]',
          default: [],
        },
        recursive: {
          type: 'boolean',
          description:
            'Optional. Whether to search recursively (primarily controlled by `**` in glob patterns). Defaults to true.',
          default: true,
        },
        useDefaultExcludes: {
          type: 'boolean',
          description:
            'Optional. Whether to apply a list of default exclusion patterns (e.g., node_modules, .git, binary files). Defaults to true.',
          default: true,
        },
        respect_git_ignore: {
          type: 'boolean',
          description:
            'Optional. Whether to respect .gitignore patterns when discovering files. Only available in git repositories. Defaults to true.',
          default: true,
        },
      },
      required: ['paths'],
    };

    super(
      ReadManyFilesTool.Name,
      'ReadManyFiles',
      `Reads content from multiple files specified by paths or glob patterns within a configured target directory. For text files, it concatenates their content into a single string. It is primarily designed for text-based files. However, it can also process image (e.g., .png, .jpg) and PDF (.pdf) files if their file names or extensions are explicitly included in the 'paths' argument. For these explicitly requested non-text files, their data is read and included in a format suitable for model consumption (e.g., base64 encoded).

This tool is useful when you need to understand or analyze a collection of files, such as:
- Getting an overview of a codebase or parts of it (e.g., all TypeScript files in the 'src' directory).
- Finding where specific functionality is implemented if the user asks broad questions about code.
- Reviewing documentation files (e.g., all Markdown files in the 'docs' directory).
- Gathering context from multiple configuration files.
- When the user asks to "read all files in X directory" or "show me the content of all Y files".

Use this tool when the user's query implies needing the content of several files simultaneously for context, analysis, or summarization. For text files, it uses default UTF-8 encoding and a '--- {filePath} ---' separator between file contents. Ensure paths are relative to the target directory. Glob patterns like 'src/**/*.js' are supported. Avoid using for single files if a more specific single-file reading tool is available, unless the user specifically requests to process a list containing just one file via this tool. Other binary files (not explicitly requested as image/PDF) are generally skipped. Default excludes apply to common non-text files (except for explicitly requested images/PDFs) and large dependency directories unless 'useDefaultExcludes' is false.`,
      parameterSchema,
    );
    this.targetDir = path.resolve(targetDir);
    this.geminiIgnorePatterns = config
      .getFileService()
      .getGeminiIgnorePatterns();
  }

  validateParams(params: ReadManyFilesParams): string | null {
    if (
      !params.paths ||
      !Array.isArray(params.paths) ||
      params.paths.length === 0
    ) {
      return 'The "paths" parameter is required and must be a non-empty array of strings/glob patterns.';
    }
    if (
      this.schema.parameters &&
      !SchemaValidator.validate(
        this.schema.parameters as Record<string, unknown>,
        params,
      )
    ) {
      if (
        !params.paths ||
        !Array.isArray(params.paths) ||
        params.paths.length === 0
      ) {
        return 'The "paths" parameter is required and must be a non-empty array of strings/glob patterns.';
      }
      return 'Parameters failed schema validation. Ensure "paths" is a non-empty array and other parameters match their expected types.';
    }
    for (const p of params.paths) {
      if (typeof p !== 'string' || p.trim() === '') {
        return 'Each item in "paths" must be a non-empty string/glob pattern.';
      }
    }
    if (
      params.include &&
      (!Array.isArray(params.include) ||
        !params.include.every((item) => typeof item === 'string'))
    ) {
      return 'If provided, "include" must be an array of strings/glob patterns.';
    }
    if (
      params.exclude &&
      (!Array.isArray(params.exclude) ||
        !params.exclude.every((item) => typeof item === 'string'))
    ) {
      return 'If provided, "exclude" must be an array of strings/glob patterns.';
    }
    return null;
  }

  getDescription(params: ReadManyFilesParams): string {
    const allPatterns = [...params.paths, ...(params.include || [])];
    const pathDesc = `using patterns: \`${allPatterns.join('`, `')}\` (within target directory: \`${this.targetDir}\`)`;

    // Determine the final list of exclusion patterns exactly as in execute method
    const paramExcludes = params.exclude || [];
    const paramUseDefaultExcludes = params.useDefaultExcludes !== false;

    const finalExclusionPatternsForDescription: string[] =
      paramUseDefaultExcludes
        ? [...DEFAULT_EXCLUDES, ...paramExcludes, ...this.geminiIgnorePatterns]
        : [...paramExcludes, ...this.geminiIgnorePatterns];

    let excludeDesc = `Excluding: ${finalExclusionPatternsForDescription.length > 0 ? `patterns like \`${finalExclusionPatternsForDescription.slice(0, 2).join('`, `')}${finalExclusionPatternsForDescription.length > 2 ? '...`' : '`'}` : 'none specified'}`;

    // Add a note if .geminiignore patterns contributed to the final list of exclusions
    if (this.geminiIgnorePatterns.length > 0) {
      const geminiPatternsInEffect = this.geminiIgnorePatterns.filter((p) =>
        finalExclusionPatternsForDescription.includes(p),
      ).length;
      if (geminiPatternsInEffect > 0) {
        excludeDesc += ` (includes ${geminiPatternsInEffect} from .geminiignore)`;
      }
    }

    return `Will attempt to read and concatenate files ${pathDesc}. ${excludeDesc}. File encoding: ${DEFAULT_ENCODING}. Separator: "${DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace('{filePath}', 'path/to/file.ext')}".`;
  }

  async execute(
    params: ReadManyFilesParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters for ${this.displayName}. Reason: ${validationError}`,
        returnDisplay: `## Parameter Error\n\n${validationError}`,
      };
    }

    const {
      paths: inputPatterns,
      include = [],
      exclude = [],
      useDefaultExcludes = true,
      respect_git_ignore = true,
    } = params;

    const respectGitIgnore =
      respect_git_ignore ?? this.config.getFileFilteringRespectGitIgnore();

    // Get centralized file discovery service
    const fileDiscovery = this.config.getFileService();

    const toolBaseDir = this.targetDir;
    const filesToConsider = new Set<string>();
    const skippedFiles: Array<{ path: string; reason: string }> = [];
    const processedFilesRelativePaths: string[] = [];
    const contentParts: PartListUnion = [];

    const effectiveExcludes = useDefaultExcludes
      ? [...DEFAULT_EXCLUDES, ...exclude, ...this.geminiIgnorePatterns]
      : [...exclude, ...this.geminiIgnorePatterns];

    const searchPatterns = [...inputPatterns, ...include];
    if (searchPatterns.length === 0) {
      return {
        llmContent: 'No search paths or include patterns provided.',
        returnDisplay: `## Information\n\nNo search paths or include patterns were specified. Nothing to read or concatenate.`,
      };
    }

    try {
      const entries = await glob(searchPatterns, {
        cwd: toolBaseDir,
        ignore: effectiveExcludes,
        nodir: true,
        dot: true,
        absolute: true,
        nocase: true,
        signal,
      });

      const filteredEntries = respectGitIgnore
        ? fileDiscovery
            .filterFiles(
              entries.map((p) => path.relative(toolBaseDir, p)),
              {
                respectGitIgnore,
              },
            )
            .map((p) => path.resolve(toolBaseDir, p))
        : entries;

      let gitIgnoredCount = 0;
      for (const absoluteFilePath of entries) {
        // Security check: ensure the glob library didn't return something outside targetDir.
        if (!absoluteFilePath.startsWith(toolBaseDir)) {
          skippedFiles.push({
            path: absoluteFilePath,
            reason: `Security: Glob library returned path outside target directory. Base: ${toolBaseDir}, Path: ${absoluteFilePath}`,
          });
          continue;
        }

        // Check if this file was filtered out by git ignore
        if (respectGitIgnore && !filteredEntries.includes(absoluteFilePath)) {
          gitIgnoredCount++;
          continue;
        }

        filesToConsider.add(absoluteFilePath);
      }

      // Add info about git-ignored files if any were filtered
      if (gitIgnoredCount > 0) {
        skippedFiles.push({
          path: `${gitIgnoredCount} file(s)`,
          reason: 'ignored',
        });
      }
    } catch (error) {
      return {
        llmContent: `Error during file search: ${getErrorMessage(error)}`,
        returnDisplay: `## File Search Error\n\nAn error occurred while searching for files:\n\`\`\`\n${getErrorMessage(error)}\n\`\`\``,
      };
    }

    const sortedFiles = Array.from(filesToConsider).sort();

    // Check if we should use smart file selection for Grok
    if (this.shouldUseSmartSelection(sortedFiles.length)) {
      return await this.executeWithSmartSelection(sortedFiles, params, signal);
    }

    for (const filePath of sortedFiles) {
      const relativePathForDisplay = path
        .relative(toolBaseDir, filePath)
        .replace(/\\/g, '/');

      const fileType = detectFileType(filePath);

      if (fileType === 'image' || fileType === 'pdf') {
        const fileExtension = path.extname(filePath).toLowerCase();
        const fileNameWithoutExtension = path.basename(filePath, fileExtension);
        const requestedExplicitly = inputPatterns.some(
          (pattern: string) =>
            pattern.toLowerCase().includes(fileExtension) ||
            pattern.includes(fileNameWithoutExtension),
        );

        if (!requestedExplicitly) {
          skippedFiles.push({
            path: relativePathForDisplay,
            reason:
              'asset file (image/pdf) was not explicitly requested by name or extension',
          });
          continue;
        }
      }

      // Use processSingleFileContent for all file types now
      const fileReadResult = await processSingleFileContent(
        filePath,
        toolBaseDir,
      );

      if (fileReadResult.error) {
        skippedFiles.push({
          path: relativePathForDisplay,
          reason: `Read error: ${fileReadResult.error}`,
        });
      } else {
        if (typeof fileReadResult.llmContent === 'string') {
          const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace(
            '{filePath}',
            relativePathForDisplay,
          );
          contentParts.push(`${separator}\n\n${fileReadResult.llmContent}\n\n`);
        } else {
          contentParts.push(fileReadResult.llmContent); // This is a Part for image/pdf
        }
        processedFilesRelativePaths.push(relativePathForDisplay);
        const lines =
          typeof fileReadResult.llmContent === 'string'
            ? fileReadResult.llmContent.split('\n').length
            : undefined;
        const mimetype = getSpecificMimeType(filePath);
        recordFileOperationMetric(
          this.config,
          FileOperation.READ,
          lines,
          mimetype,
          path.extname(filePath),
        );
      }
    }

    let displayMessage = `### ReadManyFiles Result (Target Dir: \`${this.targetDir}\`)\n\n`;
    if (processedFilesRelativePaths.length > 0) {
      displayMessage += `Successfully read and concatenated content from **${processedFilesRelativePaths.length} file(s)**.\n`;
      if (processedFilesRelativePaths.length <= 10) {
        displayMessage += `\n**Processed Files:**\n`;
        processedFilesRelativePaths.forEach(
          (p) => (displayMessage += `- \`${p}\`\n`),
        );
      } else {
        displayMessage += `\n**Processed Files (first 10 shown):**\n`;
        processedFilesRelativePaths
          .slice(0, 10)
          .forEach((p) => (displayMessage += `- \`${p}\`\n`));
        displayMessage += `- ...and ${processedFilesRelativePaths.length - 10} more.\n`;
      }
    }

    if (skippedFiles.length > 0) {
      if (processedFilesRelativePaths.length === 0) {
        displayMessage += `No files were read and concatenated based on the criteria.\n`;
      }
      if (skippedFiles.length <= 5) {
        displayMessage += `\n**Skipped ${skippedFiles.length} item(s):**\n`;
      } else {
        displayMessage += `\n**Skipped ${skippedFiles.length} item(s) (first 5 shown):**\n`;
      }
      skippedFiles
        .slice(0, 5)
        .forEach(
          (f) => (displayMessage += `- \`${f.path}\` (Reason: ${f.reason})\n`),
        );
      if (skippedFiles.length > 5) {
        displayMessage += `- ...and ${skippedFiles.length - 5} more.\n`;
      }
    } else if (
      processedFilesRelativePaths.length === 0 &&
      skippedFiles.length === 0
    ) {
      displayMessage += `No files were read and concatenated based on the criteria.\n`;
    }

    if (contentParts.length === 0) {
      contentParts.push(
        'No files matching the criteria were found or all were skipped.',
      );
    }
    return {
      llmContent: contentParts,
      returnDisplay: displayMessage.trim(),
    };
  }

  /**
   * Execute with smart file selection for Grok - create previews and let Grok choose files
   */
  private async executeWithSmartSelection(
    sortedFiles: string[],
    params: ReadManyFilesParams,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    try {
      // Stage 1: Create file previews
      const previews: string[] = [];
      const maxPreviewFiles = Math.min(sortedFiles.length, 100); // Limit to prevent too many API calls
      
      for (let i = 0; i < maxPreviewFiles; i++) {
        const preview = await this.createFilePreview(sortedFiles[i]);
        previews.push(`${i + 1}. ${preview}`);
      }

      const previewContent = previews.join('\n');
      
      // Stage 2: Ask Grok to select most relevant files
      const geminiClient = this.config.getGeminiClient();
      const selectionPrompt = `Based on the user's query and these file previews, select the 15-20 most relevant files by their numbers (1-${maxPreviewFiles}). 

File previews:
${previewContent}

Return only the numbers separated by commas (e.g., "1,5,12,25"). Focus on files that would best answer the user's question about the codebase flow.`;

      const selectionResponse = await geminiClient.generateContent(
        [{ role: 'user', parts: [{ text: selectionPrompt }] }],
        {
          temperature: 0.1,
          maxOutputTokens: 200,
        },
        signal || AbortSignal.timeout(30000)
      );

      // Stage 3: Parse the selection and read selected files
      const responseText = getResponseText(selectionResponse);
      const selectedNumbers = this.parseSelectionResponse(responseText || '');
      const selectedFiles = selectedNumbers
        .map(num => sortedFiles[num - 1])
        .filter(Boolean)
        .slice(0, 20); // Cap at 20 files max

      if (selectedFiles.length === 0) {
        // Fallback to first 10 files if selection parsing failed
        selectedFiles.push(...sortedFiles.slice(0, 10));
      }

      // Stage 4: Read selected files with token budget management
      const contentParts: PartListUnion = [];
      const processedFilesRelativePaths: string[] = [];
      let totalTokens = 0;
      const maxTokenBudget = 100000; // Leave 31K tokens for conversation context

      for (const filePath of selectedFiles) {
        if (signal?.aborted) break;

        const relativePathForDisplay = path.relative(this.targetDir, filePath).replace(/\\/g, '/');
        
        try {
          const fileReadResult = await processSingleFileContent(filePath, DEFAULT_ENCODING);
          if (typeof fileReadResult.llmContent === 'string') {
            const contentTokens = this.estimateTokens(fileReadResult.llmContent);
            
            if (totalTokens + contentTokens > maxTokenBudget) {
              // Truncate content if it would exceed budget
              const remainingTokens = maxTokenBudget - totalTokens;
              const truncatedLength = Math.max(0, remainingTokens * 4); // Rough char estimate
              const truncatedContent = fileReadResult.llmContent.substring(0, truncatedLength);
              
              const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace('{filePath}', relativePathForDisplay);
              contentParts.push(`${separator}\n\n${truncatedContent}\n\n[Content truncated due to token limits]\n\n`);
              processedFilesRelativePaths.push(relativePathForDisplay);
              break;
            }
            
            const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace('{filePath}', relativePathForDisplay);
            contentParts.push(`${separator}\n\n${fileReadResult.llmContent}\n\n`);
            processedFilesRelativePaths.push(relativePathForDisplay);
            totalTokens += contentTokens;
          }
        } catch (error) {
          // Skip files that can't be read
          continue;
        }
      }

      const displayMessage = this.createSmartSelectionDisplayMessage(
        sortedFiles.length,
        selectedFiles.length,
        processedFilesRelativePaths.length,
        totalTokens
      );

      return {
        llmContent: contentParts.length > 0 ? contentParts : ['No files could be read with the available token budget.'],
        returnDisplay: displayMessage,
      };

    } catch (error) {
      // Fallback to regular execution if smart selection fails
      return this.executeRegularSelection(sortedFiles.slice(0, 10), params, signal);
    }
  }

  /**
   * Parse Grok's file selection response
   */
  private parseSelectionResponse(response: string): number[] {
    const numbers: number[] = [];
    const matches = response.match(/\d+/g);
    if (matches) {
      for (const match of matches) {
        const num = parseInt(match, 10);
        if (num > 0 && num <= 100) {
          numbers.push(num);
        }
      }
    }
    return numbers;
  }

  /**
   * Create display message for smart selection results
   */
  private createSmartSelectionDisplayMessage(
    totalFiles: number,
    selectedFiles: number,
    processedFiles: number,
    tokenCount: number
  ): string {
    return `### ReadManyFiles Result (Target Dir: \`${this.targetDir}\`)

**Smart Selection Applied for Grok**: Analyzed ${totalFiles} files, selected ${selectedFiles} most relevant files, successfully processed ${processedFiles} files.

**Token Usage**: ~${tokenCount.toLocaleString()} tokens used out of 131K limit.

**Files processed**: ${processedFiles > 0 ? 'Successfully read and concatenated content.' : 'No files could be processed within token limits.'}

*Note: Smart file selection was used to optimize for Grok's context window. Some files may have been excluded or truncated.*`;
  }

  /**
   * Fallback method for regular file processing
   */
  private async executeRegularSelection(
    files: string[],
    params: ReadManyFilesParams,
    signal?: AbortSignal
  ): Promise<ToolResult> {
    // Simplified version that just reads first 10 files without smart selection
    const contentParts: PartListUnion = [];
    const processedFiles: string[] = [];

    for (const filePath of files.slice(0, 10)) {
      if (signal?.aborted) break;
      
      try {
        const fileReadResult = await processSingleFileContent(filePath, DEFAULT_ENCODING);
        if (typeof fileReadResult.llmContent === 'string') {
          const relativePathForDisplay = path.relative(this.targetDir, filePath).replace(/\\/g, '/');
          const separator = DEFAULT_OUTPUT_SEPARATOR_FORMAT.replace('{filePath}', relativePathForDisplay);
          contentParts.push(`${separator}\n\n${fileReadResult.llmContent}\n\n`);
          processedFiles.push(relativePathForDisplay);
        }
      } catch (error) {
        continue;
      }
    }

    return {
      llmContent: contentParts.length > 0 ? contentParts : ['No files could be read.'],
      returnDisplay: `### ReadManyFiles Result (Fallback Mode)\n\nProcessed ${processedFiles.length} files due to context limitations.`,
    };
  }

  /**
   * Create file previews for intelligent selection - reads first few lines of each file
   */
  private async createFilePreview(filePath: string): Promise<string> {
    try {
      const fileType = detectFileType(filePath);
      if (fileType !== 'text') {
        const relativePathForDisplay = path.relative(this.targetDir, filePath).replace(/\\/g, '/');
        return `${relativePathForDisplay}: [${fileType} file]`;
      }

      const fileReadResult = await processSingleFileContent(filePath, DEFAULT_ENCODING, 5, 0);
      if (typeof fileReadResult.llmContent === 'string') {
        const lines = fileReadResult.llmContent.split('\n').slice(0, 5);
        const relativePathForDisplay = path.relative(this.targetDir, filePath).replace(/\\/g, '/');
        return `${relativePathForDisplay}: ${lines.join(' | ')}`;
      }
      return `${path.relative(this.targetDir, filePath).replace(/\\/g, '/')}: [binary file]`;
    } catch (error) {
      const relativePathForDisplay = path.relative(this.targetDir, filePath).replace(/\\/g, '/');
      return `${relativePathForDisplay}: [error reading file]`;
    }
  }

  /**
   * Check if we should use smart file selection based on provider and file count
   */
  private shouldUseSmartSelection(fileCount: number): boolean {
    const provider = this.config.getProvider();
    const model = this.config.getModel();
    const limit = tokenLimit(model);
    
    // Use smart selection for Grok models (131K token limit) when many files found
    return provider === 'grok' && fileCount > 20 && limit <= 131_072;
  }

  /**
   * Estimate tokens for content using simple heuristic
   */
  private estimateTokens(content: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(content.length / 4);
  }
}
