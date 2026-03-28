import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";

import type { SessionSnapshotEntry, SessionSnapshotManifest } from "./types";

// Zod schema for runtime validation
const SessionSnapshotManifestSchema: z.ZodType<SessionSnapshotManifest> = z.object({
    sessionId: z.string(),
    cwd: z.string(),
    createdAt: z.string(),
    snapshots: z.array(
        z.object({
            snapshotId: z.string(),
            createdAt: z.string(),
            trigger: z.enum(["before_prompt", "llm_manual", "system_manual"]),
            turn: z.number(),
            label: z.string().optional(),
            reason: z.string().optional(),
            resticSnapshotId: z.string(),
            diogenesStatePath: z.string().nullable().optional(),
        }),
    ),
});

export class SnapshotManifestStore {
    constructor(private readonly manifestPath: string) {}

    async initialize(params: {
        sessionId: string;
        cwd: string;
        createdAt: string;
    }): Promise<SessionSnapshotManifest> {
        const manifest: SessionSnapshotManifest = {
            sessionId: params.sessionId,
            cwd: params.cwd,
            createdAt: params.createdAt,
            snapshots: [],
        };

        await fs.mkdir(path.dirname(this.manifestPath), { recursive: true });
        await this.writeManifest(manifest);
        return manifest;
    }

    async read(): Promise<SessionSnapshotManifest> {
        const content = await fs.readFile(this.manifestPath, "utf8");
        const parsed: unknown = JSON.parse(content);
        const result = SessionSnapshotManifestSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Invalid manifest format: ${result.error.message}`);
        }
        return result.data;
    }

    async append(entry: SessionSnapshotEntry): Promise<SessionSnapshotManifest> {
        const manifest = await this.read();
        manifest.snapshots.push(entry);
        await this.writeManifest(manifest);
        return manifest;
    }

    async list(): Promise<SessionSnapshotEntry[]> {
        const manifest = await this.read();
        return [...manifest.snapshots];
    }

    private async writeManifest(manifest: SessionSnapshotManifest): Promise<void> {
        const tempPath = `${this.manifestPath}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(manifest, null, 2), "utf8");
        await fs.rename(tempPath, this.manifestPath);
    }
}
