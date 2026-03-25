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
import { rstrip } from "../utils/str";

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

        // Get current file stats
        const content = await fs.promises.readFile(absolutePath, "utf-8");
        const lines = content.split("\n").map(l => rstrip(l));
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

        const existingEntry = this.fileWorkspace[absolutePath];

        // If file exists and totalLines match, merge ranges (using FRESH content from disk)
        if (existingEntry && existingEntry.totalLines === totalLines) {
            // Merge existing ranges with new range
            const mergedRanges = this.mergeRanges([...existingEntry.ranges, { start: startLine, end: endLine }]);

            // Extract content for merged ranges from FRESH disk content
            const allLines: string[] = [];
            for (const r of mergedRanges) {
                allLines.push(...lines.slice(r.start - 1, r.end));
            }

            const entry: FileWorkspaceEntry = {
                path: filePath,
                content: allLines,
                totalLines,
                ranges: mergedRanges,
                offsets: [],
            };

            this.fileWorkspace[absolutePath] = entry;
            return { ...entry };
        }

        // New file or totalLines changed - start fresh
        const entry: FileWorkspaceEntry = {
            path: filePath,
            content: lines.slice(startLine - 1, endLine),
            totalLines,
            ranges: [{ start: startLine, end: endLine }],
            offsets: [],
        };

        this.fileWorkspace[absolutePath] = entry;
        return { ...entry };
    }

    unloadFile(filePath: string): boolean {
        const absolutePath = this.resolvePath(filePath);
        if (this.fileWorkspace[absolutePath]) {
            delete this.fileWorkspace[absolutePath];
            return true;
        }
        return false;
    }

    async reloadFileWithRangesContent(
        filePath: string,
        content: string,
        ranges: Array<{ start: number; end: number }>,
    ): Promise<FileWorkspaceEntry | undefined> {
        const absolutePath = this.resolvePath(filePath);
        const lines = content.split("\n").map(l => rstrip(l));
        const totalLines = lines.length;

        // Filter and clamp ranges to valid line numbers
        const validRanges = ranges
            .filter(r => r.start <= r.end)
            .map(r => ({
                start: Math.max(1, Math.min(r.start, totalLines)),
                end: Math.max(1, Math.min(r.end, totalLines)),
            }))
            .filter(r => r.start <= r.end);

        if (validRanges.length === 0) {
            return undefined;
        }

        // Extract content for each range
        const allLines: string[] = [];
        for (const r of validRanges) {
            allLines.push(...lines.slice(r.start - 1, r.end));
        }

        // Create fresh entry
        const entry: FileWorkspaceEntry = {
            path: filePath,
            content: allLines,
            totalLines,
            ranges: validRanges,
            offsets: [],
        };

        this.fileWorkspace[absolutePath] = entry;
        return { ...entry };
    }

    getFileWorkspace(): FileWorkspace {
        return { ...this.fileWorkspace };
    }

    getFileEntry(filePath: string): FileWorkspaceEntry | undefined {
        const absolutePath = this.resolvePath(filePath);
        const entry = this.fileWorkspace[absolutePath];
        return entry ? { ...entry } : undefined;
    }

    updateFileContent(filePath: string, newContent: string[]): void {
        const absolutePath = this.resolvePath(filePath);
        const entry = this.fileWorkspace[absolutePath];
        if (entry) {
            entry.content = newContent;
            entry.totalLines = newContent.length;
            entry.ranges = [{ start: 1, end: newContent.length }];
            entry.offsets = [];
        }
    }

    private applyOffsets(index: number, offsets: Array<{ at: number; delta: number }>): number {
        let newIndex = index;
        for (const offset of offsets) {
            if (offset.at < index) {
                newIndex += offset.delta;
            }
        }
        return newIndex;
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
        const relative = path.relative(this.workspaceRoot, absolutePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
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

    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }
}
