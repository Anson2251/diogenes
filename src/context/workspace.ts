/**
 * Workspace management system
 */

import {
    DirectoryWorkspace,
    DirectoryEntry,
    FileWorkspace,
    FileWorkspaceEntry,
    TodoWorkspace,
    TodoItem,
} from "../types";
import * as fs from "fs";
import * as path from "path";

export class WorkspaceManager {
    private directoryWorkspace: DirectoryWorkspace = {};
    private fileWorkspace: FileWorkspace = {};
    private todoWorkspace: TodoWorkspace = { items: [] };
    private workspaceRoot: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = path.resolve(workspaceRoot);
    }

    // ==================== Directory Workspace Methods ====================

    async loadDirectory(dirPath: string): Promise<DirectoryEntry[]> {
        const absolutePath = this.resolvePath(dirPath);
        await this.validatePath(absolutePath, true);

        const entries: DirectoryEntry[] = [];

        try {
            const items = await fs.promises.readdir(absolutePath, {
                withFileTypes: true,
            });

            for (const item of items) {
                entries.push({
                    name: item.name,
                    type: item.isDirectory() ? "DIR" : "FILE",
                });
            }

            // Sort: directories first, then files, both alphabetically
            entries.sort((a, b) => {
                if (a.type === b.type) {
                    return a.name.localeCompare(b.name);
                }
                return a.type === "DIR" ? -1 : 1;
            });

            this.directoryWorkspace[dirPath] = entries;
            return entries;
        } catch (error) {
            throw new Error(
                `Failed to load directory ${dirPath}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    unloadDirectory(dirPath: string): boolean {
        if (this.directoryWorkspace[dirPath]) {
            delete this.directoryWorkspace[dirPath];
            return true;
        }
        return false;
    }

    getDirectoryWorkspace(): DirectoryWorkspace {
        return { ...this.directoryWorkspace };
    }

    getDirectoryEntries(dirPath: string): DirectoryEntry[] | undefined {
        return this.directoryWorkspace[dirPath]?.slice();
    }

    // ==================== File Workspace Methods ====================

    async loadFile(
        filePath: string,
        start?: number,
        end?: number,
    ): Promise<FileWorkspaceEntry> {
        const absolutePath = this.resolvePath(filePath);
        await this.validatePath(absolutePath, false);

        const content = await fs.promises.readFile(absolutePath, "utf-8");
        const lines = content.split("\n");
        const totalLines = lines.length;

        let startLine = start || 1;
        let endLine = end || totalLines;

        // Validate line range
        if (startLine < 1) startLine = 1;
        if (endLine > totalLines) endLine = totalLines;
        if (startLine > endLine) {
            throw new Error(
                `Invalid line range: start (${startLine}) > end (${endLine})`,
            );
        }

        const loadedLines = lines.slice(startLine - 1, endLine);
        const range = { start: startLine, end: endLine };

        let entry = this.fileWorkspace[filePath];
        if (!entry) {
            entry = {
                path: filePath,
                content: loadedLines,
                totalLines,
                ranges: [range],
            };
        } else {
            // Merge with existing ranges if possible
            const merged = this.mergeRanges([...entry.ranges, range]);
            entry.ranges = merged;
            // Reload content with merged ranges
            const allLines: string[] = [];
            for (const r of merged.sort((a, b) => a.start - b.start)) {
                allLines.push(...lines.slice(r.start - 1, r.end));
            }
            entry.content = allLines;
        }

        this.fileWorkspace[filePath] = entry;
        return { ...entry };
    }

    unloadFile(filePath: string): boolean {
        if (this.fileWorkspace[filePath]) {
            delete this.fileWorkspace[filePath];
            return true;
        }
        return false;
    }

    getFileWorkspace(): FileWorkspace {
        return { ...this.fileWorkspace };
    }

    getFileEntry(filePath: string): FileWorkspaceEntry | undefined {
        const entry = this.fileWorkspace[filePath];
        return entry ? { ...entry } : undefined;
    }

    updateFileContent(filePath: string, newContent: string[]): void {
        const entry = this.fileWorkspace[filePath];
        if (entry) {
            entry.content = [...newContent];
            // Reset to single range covering all content
            entry.ranges = [{ start: 1, end: newContent.length }];
            entry.totalLines = newContent.length;
        }
    }

    private mergeRanges(
        ranges: Array<{ start: number; end: number }>,
    ): Array<{ start: number; end: number }> {
        if (ranges.length === 0) return [];

        // Sort by start line
        const sorted = ranges.sort((a, b) => a.start - b.start);
        const merged: Array<{ start: number; end: number }> = [sorted[0]];

        for (let i = 1; i < sorted.length; i++) {
            const last = merged[merged.length - 1];
            const current = sorted[i];

            // Check if ranges overlap or are adjacent
            if (current.start <= last.end + 1) {
                // Merge ranges
                last.end = Math.max(last.end, current.end);
            } else {
                merged.push(current);
            }
        }

        return merged;
    }

    // ==================== Todo Workspace Methods ====================

    setTodoItems(items: TodoItem[]): void {
        this.todoWorkspace.items = [...items];
    }

    updateTodoItem(
        text: string,
        state: "done" | "active" | "pending",
    ): boolean {
        const item = this.todoWorkspace.items.find(
            (item) => item.text === text,
        );
        if (item) {
            item.state = state;
            return true;
        }
        return false;
    }

    appendTodoItems(texts: string[]): number {
        const newItems: TodoItem[] = texts.map((text) => ({
            text,
            state: "pending",
        }));
        this.todoWorkspace.items.push(...newItems);
        return this.todoWorkspace.items.length;
    }

    getTodoWorkspace(): TodoWorkspace {
        return { items: [...this.todoWorkspace.items] };
    }

    // ==================== Utility Methods ====================

    private resolvePath(inputPath: string): string {
        const resolved = path.isAbsolute(inputPath)
            ? inputPath
            : path.join(this.workspaceRoot, inputPath);
        return path.resolve(resolved);
    }

    private async validatePath(
        absolutePath: string,
        isDirectory: boolean,
    ): Promise<void> {
        // Check if path is within workspace
        if (!absolutePath.startsWith(this.workspaceRoot)) {
            throw new Error(
                `Path ${absolutePath} is outside workspace root ${this.workspaceRoot}`,
            );
        }

        // Check if path exists
        try {
            const stat = await fs.promises.stat(absolutePath);
            if (isDirectory && !stat.isDirectory()) {
                throw new Error(`Path ${absolutePath} is not a directory`);
            }
            if (!isDirectory && !stat.isFile()) {
                throw new Error(`Path ${absolutePath} is not a file`);
            }
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                throw new Error(`Path ${absolutePath} does not exist`);
            }
            throw error;
        }
    }

    // ==================== Statistics ====================

    getStatistics() {
        const directoryCount = Object.keys(this.directoryWorkspace).length;

        let fileCount = 0;
        let totalLines = 0;

        for (const entry of Object.values(this.fileWorkspace)) {
            fileCount++;
            totalLines += entry.content.length;
        }

        return {
            directoryCount,
            fileCount,
            totalLines,
        };
    }

    clearAll(): void {
        this.directoryWorkspace = {};
        this.fileWorkspace = {};
        this.todoWorkspace = { items: [] };
    }
}
