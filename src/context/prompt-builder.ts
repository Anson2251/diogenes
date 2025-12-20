/**
 * Prompt builder for assembling context sections
 */

import {
  DirectoryWorkspace,
  FileWorkspace,
  TodoWorkspace,
  ContextStatus,
  ContextSections
} from '../types';

export class PromptBuilder {
  private systemPrompt: string;
  private tokenLimit: number;
  private currentTokens: number = 0;

  constructor(systemPrompt: string, tokenLimit: number) {
    this.systemPrompt = systemPrompt;
    this.tokenLimit = tokenLimit;
  }

  buildContextSections(
    toolDefinitions: string,
    contextStatus: ContextStatus,
    directoryWorkspace: DirectoryWorkspace,
    fileWorkspace: FileWorkspace,
    todoWorkspace: TodoWorkspace
  ): ContextSections {
    return {
      systemPrompt: this.systemPrompt,
      toolDefinitions,
      contextStatus: this.formatContextStatus(contextStatus),
      directoryWorkspace: this.formatDirectoryWorkspace(directoryWorkspace),
      fileWorkspace: this.formatFileWorkspace(fileWorkspace),
      todoWorkspace: this.formatTodoWorkspace(todoWorkspace)
    };
  }

  assemblePrompt(sections: ContextSections): string {
    const parts = [
      sections.systemPrompt,
      sections.toolDefinitions,
      sections.contextStatus,
      sections.directoryWorkspace,
      sections.fileWorkspace,
      sections.todoWorkspace
    ];
    
    return parts.join('\n\n');
  }

  private formatContextStatus(status: ContextStatus): string {
    const { tokenUsage, directoryWorkspace, fileWorkspace } = status;
    
    return `=========CONTEXT STATUS
Token Usage: ${tokenUsage.current} / ${tokenUsage.limit} (${tokenUsage.percentage.toFixed(1)}%)
Directory Workspace: ${directoryWorkspace.count} directories loaded
File Workspace: ${fileWorkspace.count} files, ${fileWorkspace.totalLines} lines loaded
=========`;
  }

  private formatDirectoryWorkspace(workspace: DirectoryWorkspace): string {
    if (Object.keys(workspace).length === 0) {
      return '=========DIRECTORY WORKSPACE\n(empty)\n=========';
    }

    const parts: string[] = ['=========DIRECTORY WORKSPACE'];
    
    for (const [path, entries] of Object.entries(workspace)) {
      parts.push(path);
      parts.push('---------');
      
      for (const entry of entries) {
        parts.push(`${entry.type.padEnd(4)} | ${entry.name}`);
      }
      
      parts.push('---------');
      parts.push(''); // Empty line between directories
    }
    
    // Remove last empty line and add closing marker
    if (parts[parts.length - 1] === '') {
      parts.pop();
    }
    parts.push('=========');
    
    return parts.join('\n');
  }

  private formatFileWorkspace(workspace: FileWorkspace): string {
    if (Object.keys(workspace).length === 0) {
      return '=========FILE WORKSPACE\n(empty)\n=========';
    }

    const parts: string[] = ['=========FILE WORKSPACE'];
    
    for (const [path, entry] of Object.entries(workspace)) {
      parts.push(path);
      parts.push('---------');
      
      let currentLine = 1;
      for (const range of entry.ranges.sort((a, b) => a.start - b.start)) {
        // Add [UNLOADED] marker if there's a gap
        if (range.start > currentLine) {
          parts.push('[UNLOADED]');
          parts.push('');
        }
        
        // Add lines in this range
        const rangeStartIndex = range.start - 1;
        const rangeEndIndex = range.end;
        const rangeLines = entry.content.slice(rangeStartIndex, rangeEndIndex);
        
        for (let i = 0; i < rangeLines.length; i++) {
          const lineNum = range.start + i;
          const line = rangeLines[i];
          parts.push(`${lineNum.toString().padStart(3)} | ${line}`);
        }
        
        currentLine = range.end + 1;
      }
      
      // Add final [UNLOADED] if file continues beyond loaded ranges
      if (currentLine <= entry.totalLines) {
        parts.push('[UNLOADED]');
      }
      
      parts.push('---------');
      parts.push(''); // Empty line between files
    }
    
    // Remove last empty line and add closing marker
    if (parts[parts.length - 1] === '') {
      parts.pop();
    }
    parts.push('=========');
    
    return parts.join('\n');
  }

  private formatTodoWorkspace(workspace: TodoWorkspace): string {
    if (workspace.items.length === 0) {
      return '=========TODO\n(empty)\n=========';
    }

    const parts: string[] = ['=========TODO'];
    
    for (const item of workspace.items) {
      let marker: string;
      switch (item.state) {
        case 'done':
          marker = '[x]';
          break;
        case 'active':
          marker = '[*]';
          break;
        case 'pending':
          marker = '[ ]';
          break;
        default:
          marker = '[ ]';
      }
      parts.push(`${marker} ${item.text}`);
    }
    
    parts.push('=========');
    return parts.join('\n');
  }

  // Simple token estimation (approximate)
  estimateTokens(text: string): number {
    // Rough estimate: 1 token ≈ 4 characters for English text
    // This is a simplification; real tokenization would be more complex
    return Math.ceil(text.length / 4);
  }

  updateTokenUsage(sections: ContextSections): number {
    const fullPrompt = this.assemblePrompt(sections);
    this.currentTokens = this.estimateTokens(fullPrompt);
    return this.currentTokens;
  }

  getCurrentTokens(): number {
    return this.currentTokens;
  }

  getTokenLimit(): number {
    return this.tokenLimit;
  }

  getTokenPercentage(): number {
    return (this.currentTokens / this.tokenLimit) * 100;
  }
}