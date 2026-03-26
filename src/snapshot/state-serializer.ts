import * as fs from "fs/promises";
import * as path from "path";
import type { PersistedDiogenesStatePlaceholder } from "./types";

export interface SnapshotStateSerializer {
    serialize(params: {
        snapshotId: string;
        sessionId: string;
        cwd: string;
        createdAt: string;
        updatedAt: string;
    }): Promise<{ statePath: string }>;
    deserialize(statePath: string): Promise<PersistedDiogenesStatePlaceholder>;
}

export class PlaceholderStateSerializer implements SnapshotStateSerializer {
    constructor(private readonly stateDir: string) {}

    async serialize(params: {
        snapshotId: string;
        sessionId: string;
        cwd: string;
        createdAt: string;
        updatedAt: string;
    }): Promise<{ statePath: string }> {
        await fs.mkdir(this.stateDir, { recursive: true });

        const statePath = path.join(this.stateDir, `${params.snapshotId}.json`);
        const payload: PersistedDiogenesStatePlaceholder = {
            version: 1,
            kind: "placeholder",
            sessionId: params.sessionId,
            cwd: params.cwd,
            createdAt: params.createdAt,
            updatedAt: params.updatedAt,
            note: "Diogenes state serialization placeholder. Full state persistence is not implemented yet.",
        };

        await fs.writeFile(statePath, JSON.stringify(payload, null, 2), "utf8");
        return { statePath };
    }

    async deserialize(statePath: string): Promise<PersistedDiogenesStatePlaceholder> {
        const content = await fs.readFile(statePath, "utf8");
        return JSON.parse(content) as PersistedDiogenesStatePlaceholder;
    }
}
