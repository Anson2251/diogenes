import * as fs from "fs/promises";
import * as path from "path";
import type { SessionSnapshotEntry, SessionSnapshotManifest } from "./types";

export class SnapshotManifestStore {
    constructor(private readonly manifestPath: string) {}

    async initialize(params: { sessionId: string; cwd: string; createdAt: string }): Promise<SessionSnapshotManifest> {
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
        return JSON.parse(content) as SessionSnapshotManifest;
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
