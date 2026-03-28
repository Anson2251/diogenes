/**
 * Workspace management system
 */

import * as fs from "fs";
import * as path from "path";

import {
    DirectoryWorkspace,
    DirectoryEntry,
    FileWorkspace,
    FileWorkspaceEntry,
    TodoWorkspace,
    TodoItem,
    NotepadWorkspace,
} from "../types";
import { rstrip } from "../utils/str";

interface GitIgnoreRule {
    pattern: string;
    negated: boolean;
}

interface WorkspaceWatchOptions {
    enabled?: boolean;
    debounceMs?: number;
}

export class WorkspaceManager {
    private directoryWorkspace: DirectoryWorkspace = {};
    private fileWorkspace: FileWorkspace = {};
    private todoWorkspace: TodoWorkspace = { items: [] };
    private notepadWorkspace: NotepadWorkspace = { lines: [] };
    private workspaceRoot: string;
    private directoryWatchers: Map<string, fs.FSWatcher> = new Map();
    private fileWatchers: Map<string, fs.FSWatcher> = new Map();
    private filePollingWatchers: Map<string, (curr: fs.Stats, prev: fs.Stats) => void> = new Map();
    private directoryRefreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private fileRefreshTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
    private watchEnabled: boolean;
    private watchDebounceMs: number;

    constructor(workspaceRoot: string, watchOptions: WorkspaceWatchOptions = {}) {
        this.workspaceRoot = path.resolve(workspaceRoot);
        this.watchEnabled = watchOptions.enabled ?? true;
        this.watchDebounceMs = Math.max(0, watchOptions.debounceMs ?? 80);
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
            this.ensureDirectoryWatcher(dirPath, absolutePath);
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
            this.stopDirectoryWatcher(dirPath);
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

    async loadFile(filePath: string, start?: number, end?: number): Promise<FileWorkspaceEntry> {
        const absolutePath = await this.resolveReadableFilePath(filePath);

        // Get current file stats
        const content = await fs.promises.readFile(absolutePath, "utf-8");
        const lines = content.split("\n").map((l) => rstrip(l));
        const totalLines = lines.length;

        let startLine = start || 1;
        let endLine = end || totalLines;

        // Validate line range
        if (startLine < 1) startLine = 1;
        if (endLine > totalLines) endLine = totalLines;
        if (startLine > endLine) {
            throw new Error(`Invalid line range: start (${startLine}) > end (${endLine})`);
        }

        const existingEntry = this.fileWorkspace[absolutePath];

        // If file exists and totalLines match, merge ranges (using FRESH content from disk)
        if (existingEntry && existingEntry.totalLines === totalLines) {
            // Merge existing ranges with new range
            const mergedRanges = this.mergeRanges([
                ...existingEntry.ranges,
                { start: startLine, end: endLine },
            ]);

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
        this.ensureFileWatcher(absolutePath);
        return { ...entry };
    }

    async resolveReadableFilePath(filePath: string): Promise<string> {
        const absolutePath = this.resolvePath(filePath);
        await this.validatePath(absolutePath, false);
        await this.validateReadAccess(absolutePath);
        return absolutePath;
    }

    unloadFile(filePath: string): boolean {
        const absolutePath = this.resolvePath(filePath);
        if (this.fileWorkspace[absolutePath]) {
            delete this.fileWorkspace[absolutePath];
            this.stopFileWatcher(absolutePath);
            return true;
        }
        return false;
    }

    reloadFileWithRangesContent(
        filePath: string,
        content: string,
        ranges: Array<{ start: number; end: number }>,
    ): FileWorkspaceEntry | undefined {
        const absolutePath = this.resolvePath(filePath);
        const lines = content.split("\n").map((l) => rstrip(l));
        const totalLines = lines.length;

        // Filter and clamp ranges to valid line numbers
        const validRanges = ranges
            .filter((r) => r.start <= r.end)
            .map((r) => ({
                start: Math.max(1, Math.min(r.start, totalLines)),
                end: Math.max(1, Math.min(r.end, totalLines)),
            }))
            .filter((r) => r.start <= r.end);

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
        this.ensureFileWatcher(absolutePath);
        return { ...entry };
    }

    async syncLoadedFileAfterEdit(
        filePath: string,
        appliedEdits: Array<{ matchedRange: [number, number]; newRange: [number, number] }>,
    ): Promise<
        | { loaded_ranges: Array<{ start: number; end: number }>; total_lines_in_workspace: number }
        | undefined
    > {
        const absolutePath = this.resolvePath(filePath);
        const existingEntry = this.fileWorkspace[absolutePath];
        if (!existingEntry) {
            return undefined;
        }

        const content = await fs.promises.readFile(absolutePath, "utf-8");
        const lines = content.split("\n").map((l) => rstrip(l));
        const totalLines = lines.length;

        const editDeltas = appliedEdits.map((edit) => {
            const originalLineCount = edit.matchedRange[1] - edit.matchedRange[0] + 1;
            const newLineCount = edit.newRange[1] - edit.newRange[0] + 1;
            return {
                at: edit.matchedRange[0],
                delta: newLineCount - originalLineCount,
            };
        });
        editDeltas.sort((a, b) => b.at - a.at);

        const updatedRanges = existingEntry.ranges.map((range) => {
            let newStart = range.start;
            let newEnd = range.end;
            for (const delta of editDeltas) {
                if (delta.at < range.start) {
                    newStart += delta.delta;
                    newEnd += delta.delta;
                } else if (delta.at <= range.end) {
                    newEnd += delta.delta;
                }
            }
            newStart = Math.max(1, Math.min(newStart, totalLines));
            newEnd = Math.max(newStart, Math.min(newEnd, totalLines));
            return { start: newStart, end: newEnd };
        });

        const mergedRanges = this.mergeRanges(updatedRanges);
        const clampedRanges = mergedRanges
            .filter((r) => r.start <= r.end)
            .map((r) => ({
                start: Math.max(1, Math.min(r.start, totalLines)),
                end: Math.max(1, Math.min(r.end, totalLines)),
            }))
            .filter((r) => r.start <= r.end);

        if (clampedRanges.length === 0) {
            delete this.fileWorkspace[absolutePath];
            this.stopFileWatcher(absolutePath);
            return undefined;
        }

        const allLines: string[] = [];
        for (const r of clampedRanges) {
            allLines.push(...lines.slice(r.start - 1, r.end));
        }

        this.fileWorkspace[absolutePath] = {
            path: existingEntry.path,
            content: allLines,
            totalLines,
            ranges: clampedRanges,
            offsets: [],
        };

        this.ensureFileWatcher(absolutePath);

        return {
            loaded_ranges: clampedRanges,
            total_lines_in_workspace: allLines.length,
        };
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

    updateTodoItem(text: string, state: "done" | "active" | "pending"): boolean {
        const item = this.todoWorkspace.items.find((item) => item.text === text);
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

    setNotepadLines(lines: string[]): void {
        this.notepadWorkspace.lines = [...lines];
    }

    appendNotepadLines(lines: string[]): number {
        this.notepadWorkspace.lines.push(...lines);
        return this.notepadWorkspace.lines.length;
    }

    clearNotepad(): void {
        this.notepadWorkspace.lines = [];
    }

    getNotepadWorkspace(): NotepadWorkspace {
        return { lines: [...this.notepadWorkspace.lines] };
    }

    clearLoadedState(): void {
        for (const dirPath of Object.keys(this.directoryWorkspace)) {
            this.unloadDirectory(dirPath);
        }

        for (const absolutePath of Object.keys(this.fileWorkspace)) {
            const entry = this.fileWorkspace[absolutePath];
            if (entry) {
                this.unloadFile(entry.path);
            }
        }

        this.setTodoItems([]);
        this.clearNotepad();
    }

    // ==================== Utility Methods ====================

    private resolvePath(inputPath: string): string {
        const resolved = path.isAbsolute(inputPath)
            ? inputPath
            : path.join(this.workspaceRoot, inputPath);
        return path.resolve(resolved);
    }

    private async validatePath(absolutePath: string, isDirectory: boolean): Promise<void> {
        // Check if path is within workspace
        const relative = path.relative(this.workspaceRoot, absolutePath);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Path ${absolutePath} is outside workspace root ${this.workspaceRoot}`);
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
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                throw new Error(`Path ${absolutePath} does not exist`);
            }
            throw error;
        }
    }

    private async validateReadAccess(absolutePath: string): Promise<void> {
        if (await this.isGitIgnored(absolutePath)) {
            const relativePath = this.toWorkspaceRelativePath(absolutePath);
            throw new Error(`Path ${relativePath} is blocked because it is ignored by .gitignore`);
        }
    }

    private async isGitIgnored(absolutePath: string): Promise<boolean> {
        const relativePath = this.toWorkspaceRelativePath(absolutePath);
        const pathParts =
            path.dirname(relativePath) === "." ? [] : path.dirname(relativePath).split(path.sep);
        const ignoreDirs = [this.workspaceRoot];

        let currentDir = this.workspaceRoot;
        for (const part of pathParts) {
            currentDir = path.join(currentDir, part);
            ignoreDirs.push(currentDir);
        }

        let ignored = false;
        for (const ignoreDir of ignoreDirs) {
            const rules = await this.readGitIgnoreRules(ignoreDir);
            if (rules.length === 0) {
                continue;
            }

            const relativeToIgnoreDir = this.normalizeForGitIgnore(
                path.relative(ignoreDir, absolutePath),
            );

            for (const rule of rules) {
                if (this.matchesGitIgnoreRule(relativeToIgnoreDir, rule.pattern)) {
                    ignored = !rule.negated;
                }
            }
        }

        return ignored;
    }

    private async readGitIgnoreRules(directory: string): Promise<GitIgnoreRule[]> {
        const ignorePath = path.join(directory, ".gitignore");

        try {
            const content = await fs.promises.readFile(ignorePath, "utf-8");
            return content
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith("#"))
                .map((line) => ({
                    negated: line.startsWith("!"),
                    pattern: this.normalizeForGitIgnore(
                        line.startsWith("!") ? line.slice(1) : line,
                    ).replace(/\/+$/, (match) => (match ? "/" : match)),
                }));
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return [];
            }
            throw error;
        }
    }

    private matchesGitIgnoreRule(relativePath: string, pattern: string): boolean {
        if (!pattern) {
            return false;
        }

        const directoryOnly = pattern.endsWith("/");
        const normalizedPattern = directoryOnly ? pattern.slice(0, -1) : pattern;
        const anchored = normalizedPattern.startsWith("/");
        const body = anchored ? normalizedPattern.slice(1) : normalizedPattern;
        const hasSlash = body.includes("/");
        const regexBody = this.escapeGitIgnorePattern(body);

        if (!regexBody) {
            return false;
        }

        const prefix = anchored || hasSlash ? "^" : "(?:^|.*/)";
        const suffix = directoryOnly ? "(?:/.*)?$" : "(?:$|/.*$)";
        return new RegExp(`${prefix}${regexBody}${suffix}`).test(relativePath);
    }

    private escapeGitIgnorePattern(pattern: string): string {
        let escaped = "";

        for (let i = 0; i < pattern.length; i++) {
            const char = pattern[i];
            const next = pattern[i + 1];

            if (char === "*") {
                if (next === "*") {
                    escaped += ".*";
                    i++;
                } else {
                    escaped += "[^/]*";
                }
                continue;
            }

            if (char === "?") {
                escaped += "[^/]";
                continue;
            }

            if ("\\^$+?.()|{}[]".includes(char)) {
                escaped += `\\${char}`;
                continue;
            }

            escaped += char;
        }

        return escaped;
    }

    private toWorkspaceRelativePath(absolutePath: string): string {
        return path.relative(this.workspaceRoot, absolutePath);
    }

    private normalizeForGitIgnore(value: string): string {
        return value.split(path.sep).join("/");
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
        this.stopAllWatchers();
        this.directoryWorkspace = {};
        this.fileWorkspace = {};
        this.todoWorkspace = { items: [] };
        this.notepadWorkspace = { lines: [] };
    }

    getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    private ensureDirectoryWatcher(dirPath: string, absolutePath: string): void {
        if (!this.watchEnabled) {
            return;
        }
        if (this.directoryWatchers.has(dirPath)) {
            return;
        }

        try {
            const watcher = fs.watch(absolutePath, () => {
                this.scheduleDirectoryRefresh(dirPath);
            });
            if (typeof watcher.unref === "function") {
                watcher.unref();
            }

            watcher.on("error", () => {
                this.stopDirectoryWatcher(dirPath);
            });

            this.directoryWatchers.set(dirPath, watcher);
        } catch {
            // ignore watcher setup failures and keep workspace usable
        }
    }

    private ensureFileWatcher(absolutePath: string): void {
        if (!this.watchEnabled) {
            return;
        }
        if (!this.fileWatchers.has(absolutePath)) {
            try {
                const fileDir = path.dirname(absolutePath);
                const fileName = path.basename(absolutePath);
                const watcher = fs.watch(fileDir, (_eventType, changedName) => {
                    if (!changedName || changedName.toString() === fileName) {
                        this.scheduleFileRefresh(absolutePath);
                    }
                });
                if (typeof watcher.unref === "function") {
                    watcher.unref();
                }

                watcher.on("error", () => {
                    this.stopFileWatcher(absolutePath);
                });

                this.fileWatchers.set(absolutePath, watcher);
            } catch {
                // ignore watcher setup failures and keep workspace usable
            }
        }

        if (!this.filePollingWatchers.has(absolutePath)) {
            const pollHandler = (curr: fs.Stats, prev: fs.Stats) => {
                if (curr.mtimeMs !== prev.mtimeMs || curr.size !== prev.size) {
                    this.scheduleFileRefresh(absolutePath);
                }
            };
            fs.watchFile(absolutePath, { interval: 100 }, pollHandler);
            this.filePollingWatchers.set(absolutePath, pollHandler);
        }
    }

    private scheduleDirectoryRefresh(dirPath: string): void {
        const existing = this.directoryRefreshTimers.get(dirPath);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.directoryRefreshTimers.delete(dirPath);
            void this.refreshDirectoryEntries(dirPath);
        }, this.watchDebounceMs);

        this.directoryRefreshTimers.set(dirPath, timer);
    }

    private scheduleFileRefresh(absolutePath: string): void {
        const existing = this.fileRefreshTimers.get(absolutePath);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.fileRefreshTimers.delete(absolutePath);
            void this.refreshLoadedFileEntry(absolutePath);
        }, this.watchDebounceMs);

        this.fileRefreshTimers.set(absolutePath, timer);
    }

    private async refreshDirectoryEntries(dirPath: string): Promise<void> {
        if (!this.directoryWorkspace[dirPath]) {
            return;
        }

        try {
            const absolutePath = this.resolvePath(dirPath);
            const items = await fs.promises.readdir(absolutePath, {
                withFileTypes: true,
            });

            const entries: DirectoryEntry[] = items.map((item) => ({
                name: item.name,
                type: item.isDirectory() ? "DIR" : "FILE",
            }));

            entries.sort((a, b) => {
                if (a.type === b.type) {
                    return a.name.localeCompare(b.name);
                }
                return a.type === "DIR" ? -1 : 1;
            });

            this.directoryWorkspace[dirPath] = entries;
        } catch {
            delete this.directoryWorkspace[dirPath];
            this.stopDirectoryWatcher(dirPath);
        }
    }

    private async refreshLoadedFileEntry(absolutePath: string): Promise<void> {
        const existingEntry = this.fileWorkspace[absolutePath];
        if (!existingEntry) {
            return;
        }

        try {
            const content = await fs.promises.readFile(absolutePath, "utf-8");
            const lines = content.split("\n").map((l) => rstrip(l));
            const totalLines = lines.length;

            const mergedRanges = this.mergeRanges(existingEntry.ranges.map((r) => ({ ...r })));
            const clampedRanges = mergedRanges
                .map((r) => ({
                    start: Math.max(1, Math.min(r.start, totalLines)),
                    end: Math.max(1, Math.min(r.end, totalLines)),
                }))
                .filter((r) => r.start <= r.end);

            if (clampedRanges.length === 0) {
                delete this.fileWorkspace[absolutePath];
                this.stopFileWatcher(absolutePath);
                return;
            }

            const allLines: string[] = [];
            for (const r of clampedRanges) {
                allLines.push(...lines.slice(r.start - 1, r.end));
            }

            this.fileWorkspace[absolutePath] = {
                path: existingEntry.path,
                content: allLines,
                totalLines,
                ranges: clampedRanges,
                offsets: [],
            };
        } catch {
            delete this.fileWorkspace[absolutePath];
            this.stopFileWatcher(absolutePath);
        }
    }

    private stopDirectoryWatcher(dirPath: string): void {
        const watcher = this.directoryWatchers.get(dirPath);
        if (watcher) {
            watcher.close();
            this.directoryWatchers.delete(dirPath);
        }
        const timer = this.directoryRefreshTimers.get(dirPath);
        if (timer) {
            clearTimeout(timer);
            this.directoryRefreshTimers.delete(dirPath);
        }
    }

    private stopFileWatcher(absolutePath: string): void {
        const watcher = this.fileWatchers.get(absolutePath);
        if (watcher) {
            watcher.close();
            this.fileWatchers.delete(absolutePath);
        }
        const pollHandler = this.filePollingWatchers.get(absolutePath);
        if (pollHandler) {
            fs.unwatchFile(absolutePath, pollHandler);
            this.filePollingWatchers.delete(absolutePath);
        }
        const timer = this.fileRefreshTimers.get(absolutePath);
        if (timer) {
            clearTimeout(timer);
            this.fileRefreshTimers.delete(absolutePath);
        }
    }

    private stopAllWatchers(): void {
        for (const dirPath of this.directoryWatchers.keys()) {
            this.stopDirectoryWatcher(dirPath);
        }
        for (const absolutePath of this.fileWatchers.keys()) {
            this.stopFileWatcher(absolutePath);
        }
    }
}
